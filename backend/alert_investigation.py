"""Read-only alert investigation workflow and evidence assembly."""
import json

from xai_service import explain_reading


INVESTIGATION_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "inspect_recent_sensor_history",
            "description": "Inspect the selected alert sensor's recent readings and trend. This read-only tool is scoped to the alert being investigated.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "inspect_model_explanation",
            "description": "Get the anomaly model's prediction and SHAP signals for the selected alert reading. This read-only tool is scoped to the alert being investigated.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


def _investigation_threshold(metric_type, value, thresholds):
    rule = thresholds.get(metric_type)
    if not rule:
        return {"available": False, "status": "unknown", "message": "No threshold rule is configured for this metric."}

    minimum, maximum, margin = rule["min"], rule["max"], rule["warning_margin"]
    if (minimum is not None and value < minimum) or (maximum is not None and value > maximum):
        status = "critical"
    elif (minimum is not None and value < minimum + margin) or (maximum is not None and value > maximum - margin):
        status = "warning"
    else:
        status = "ok"

    if minimum is not None and maximum is not None:
        message = f"Configured safe range: {minimum:g}–{maximum:g}. Current reading: {value:g}."
    elif minimum is not None:
        message = f"Configured minimum: {minimum:g}. Current reading: {value:g}."
    else:
        message = f"Configured maximum: {maximum:g}. Current reading: {value:g}."
    return {"available": True, "status": status, "min": minimum, "max": maximum, "message": message}


def build_investigation(target, history, client, model_name, thresholds, playbooks=None):
    history_rows = [dict(row) for row in reversed(history)]
    threshold = _investigation_threshold(target["metric_type"], float(target["value"]), thresholds)
    alert = {
        "reading_id": target["id"],
        "sensor_code": target["sensor_code"],
        "sensor_name": target["sensor_name"],
        "metric_type": target["metric_type"],
        "unit": target["unit"],
        "value": float(target["value"]),
        "timestamp": target["timestamp"],
        "room_name": target["room_name"],
        "room_code": target["room_code"],
        "data_center_name": target["data_center_name"],
        "location": target["location"],
    }

    def inspect_history():
        values = [float(row["value"]) for row in history_rows]
        if not values:
            return {"available": False, "message": "No earlier sensor history is available."}
        average = sum(values) / len(values)
        return {
            "available": True,
            "window_readings": len(values),
            "from": history_rows[0]["timestamp"],
            "to": history_rows[-1]["timestamp"],
            "first_value": round(values[0], 3),
            "latest_value": round(values[-1], 3),
            "minimum": round(min(values), 3),
            "maximum": round(max(values), 3),
            "average": round(average, 3),
            "change": round(values[-1] - values[0], 3),
            "recent_values": [round(value, 3) for value in values[-12:]],
            "unit": target["unit"],
        }

    def inspect_model():
        try:
            explanation = explain_reading(history_rows[-6:], alert)
            return {
                "available": True,
                "prediction": explanation["prediction"],
                "anomaly_probability": explanation["probability"],
                "top_signals": explanation["top_features"],
            }
        except Exception as error:
            return {"available": False, "message": f"Model explanation unavailable: {error.__class__.__name__}."}

    tool_results = {}
    investigation_steps = []

    playbook_hints = ""
    if playbooks:
        matched = [
            f"- {p['title']}: {p['recommended_actions']}"
            for p in playbooks
            if not p.get("metric_type") or p.get("metric_type") == target["metric_type"]
        ]
        if matched:
            playbook_hints = " Operational SOP guidance for human checks: " + " | ".join(matched[:2]) + ". "

    messages = [
        {
            "role": "system",
            "content": (
                "You are PulseDC's read-only alert investigation agent. Investigate only the supplied alert. "
                "Use the available inspection tools before concluding; inspect both recent history and the model explanation. "
                "Never claim a root cause: these signals show evidence, not causation. Distinguish threshold status from model prediction. "
                "Never acknowledge, resolve, change thresholds, or control equipment. Recommend checks for a human to perform. "
                f"{playbook_hints}"
                "Use only supplied facts; state when evidence is unavailable. Return only a JSON object with keys "
                "summary (one or two plain-language sentences) and recommended_checks (array of at most three short strings)."
            ),
        },
        {
            "role": "user",
            "content": json.dumps({"alert": alert, "threshold_check": threshold}, ensure_ascii=False),
        },
    ]

    agent_status = "evidence-only"
    agent_summary = None
    recommended_checks = []
    if client:
        try:
            response_message = client.chat.completions.create(
                model=model_name,
                messages=messages,
                tools=INVESTIGATION_TOOLS,
                tool_choice="auto",
                temperature=0.1,
                max_tokens=900,
            ).choices[0].message

            for _step in range(4):
                if not response_message.tool_calls:
                    break
                messages.append(response_message)
                for tool_call in response_message.tool_calls:
                    tool_name = tool_call.function.name
                    if tool_name == "inspect_recent_sensor_history":
                        if "history" not in tool_results:
                            tool_results["history"] = inspect_history()
                        result = tool_results["history"]
                        step_label = "Reviewed recent sensor history"
                    elif tool_name == "inspect_model_explanation":
                        if "model" not in tool_results:
                            tool_results["model"] = inspect_model()
                        result = tool_results["model"]
                        step_label = "Reviewed anomaly model signals"
                    else:
                        result = {"available": False, "message": "Tool is not available."}
                        step_label = "Skipped unsupported tool request"
                    investigation_steps.append(step_label)
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "name": tool_name,
                        "content": json.dumps(result, ensure_ascii=False),
                    })
                response_message = client.chat.completions.create(
                    model=model_name,
                    messages=messages,
                    tools=INVESTIGATION_TOOLS,
                    tool_choice="auto",
                    temperature=0.1,
                    max_tokens=900,
                ).choices[0].message

            content = response_message.content or ""
            try:
                parsed = json.loads(content)
                if isinstance(parsed, dict):
                    agent_summary = parsed.get("summary")
                    recommended_checks = parsed.get("recommended_checks", [])
            except (TypeError, json.JSONDecodeError):
                agent_summary = None
            if (
                isinstance(agent_summary, str)
                and agent_summary.strip()
                and isinstance(recommended_checks, list)
                and {"history", "model"}.issubset(tool_results)
            ):
                agent_status = "ai-assisted"
                recommended_checks = [str(item)[:240] for item in recommended_checks[:3]]
            else:
                agent_summary = None
                recommended_checks = []
        except Exception as error:
            print(f"Alert investigation agent unavailable: {error}")

    if "history" not in tool_results:
        tool_results["history"] = inspect_history()
        investigation_steps.append("Reviewed recent sensor history")
    if "model" not in tool_results:
        tool_results["model"] = inspect_model()
        investigation_steps.append("Reviewed anomaly model signals")

    if not agent_summary:
        model = tool_results["model"]
        if model.get("available"):
            model_text = f"The anomaly model assessed this as {model['prediction']} ({round(model['anomaly_probability'] * 100)}% displayed risk)."
        else:
            model_text = "The anomaly model result is unavailable."
        agent_summary = f"The threshold check is {threshold['status']}: {threshold['message']} {model_text}"
        recommended_checks = [
            "Verify the sensor reading against the local gauge or a second sensor.",
            "Inspect the affected equipment using your site's operating procedure.",
            "Have an operator review this alert before acknowledging or resolving it.",
        ]

    evidence = {
        "alert": alert,
        "threshold_check": threshold,
        "history": tool_results["history"],
        "model": tool_results["model"],
    }
    return {
        "alert": alert,
        "threshold": threshold,
        "tool_results": tool_results,
        "investigation_steps": investigation_steps,
        "agent_status": agent_status,
        "agent_summary": agent_summary,
        "recommended_checks": recommended_checks,
        "evidence": evidence,
    }
