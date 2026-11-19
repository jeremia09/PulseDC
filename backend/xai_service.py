"""
PulseDC — XAI service.

Loads the RandomForest anomaly model trained in Colab (PulseDC_XAI_Colab.ipynb)
and its feature schema, then produces SHAP-based explanations for individual
sensor readings on request.

Drop this file into PulseDC-backend/ alongside app.py, and put
`pulsedc_anomaly_model.pkl` + `pulsedc_feature_schema.json` (downloaded from
the Colab notebook) in the same folder.

Add to requirements.txt:
    scikit-learn==1.5.2
    shap==0.46.0
    joblib==1.4.2
"""

import json
import os

import joblib
import pandas as pd
import shap

MODEL_PATH = os.path.join(os.path.dirname(__file__), "pulsedc_anomaly_model.pkl")
SCHEMA_PATH = os.path.join(os.path.dirname(__file__), "pulsedc_feature_schema.json")

_model = None
_explainer = None
_schema = None


def _load():
    """Lazy-load the model/explainer once per process."""
    global _model, _explainer, _schema
    if _model is None:
        if not os.path.exists(MODEL_PATH) or not os.path.exists(SCHEMA_PATH):
            raise FileNotFoundError(
                "Model files missing. Run PulseDC_XAI_Colab.ipynb, download "
                "pulsedc_anomaly_model.pkl and pulsedc_feature_schema.json, "
                "and place them next to xai_service.py."
            )
        _model = joblib.load(MODEL_PATH)
        with open(SCHEMA_PATH) as f:
            _schema = json.load(f)
        _explainer = shap.TreeExplainer(_model)
    return _model, _explainer, _schema


def _parse_metric_type(sensor_code: str) -> str:
    for token in sensor_code.split("-"):
        if token in ("TEMP", "HUM", "PRESSURE", "FLOW"):
            return token
    return "UNKNOWN"


def build_features(history_rows, target_row):
    """
    history_rows: list of dicts [{"value": float, "timestamp": str}, ...] for the
        same sensor, ordered oldest -> newest, ending at (and including) the
        reading being explained. At least 1 row required; 6+ gives a real
        rolling window like training did.
    target_row: dict for the reading being explained
        {"sensor_code": str, "value": float, "timestamp": str}

    Returns a single-row pandas DataFrame matching the training feature schema.
    """
    _, _, schema = _load()

    df = pd.DataFrame(history_rows)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df = df.sort_values("timestamp")

    rolling_mean_6 = df["value"].tail(6).mean()
    rolling_std_6 = df["value"].tail(6).std()
    rolling_std_6 = 0.0 if pd.isna(rolling_std_6) else rolling_std_6
    delta_prev = 0.0 if len(df) < 2 else df["value"].iloc[-1] - df["value"].iloc[-2]

    ts = pd.to_datetime(target_row["timestamp"])
    metric_type = _parse_metric_type(target_row["sensor_code"])

    row = {
        "value": target_row["value"],
        "rolling_mean_6": rolling_mean_6,
        "rolling_std_6": rolling_std_6,
        "delta_prev": delta_prev,
        "hour_of_day": ts.hour,
    }
    raw = pd.DataFrame([row])
    raw["metric_type"] = metric_type
    encoded = pd.get_dummies(raw, columns=["metric_type"])

    # Reindex to the exact training column order/schema; anything missing
    # (e.g. a metric_type not seen for this row) becomes 0.
    encoded = encoded.reindex(columns=schema["feature_columns"], fill_value=0)
    return encoded


def _anomaly_shap_row(shap_values):
    """
    Return the 1-D array of SHAP contributions for the "anomalous" class of the
    first (only) row, whatever shape this SHAP version produced:
      - older SHAP: list [class_0 (n, f), class_1 (n, f)]
      - newer SHAP: one 3-D array (n, f, classes)
      - regression-style 2-D array (n, f)
    """
    if isinstance(shap_values, list):
        return shap_values[1][0]
    if getattr(shap_values, "ndim", 2) == 3:
        return shap_values[0, :, 1]
    return shap_values[0]


def explain_reading(history_rows, target_row, top_n=5):
    """
    Returns a JSON-serializable explanation:
    {
      "prediction": "anomalous" | "normal",
      "probability": float,        # model's P(anomalous)
      "base_value": float,         # SHAP expected value (model's average output)
      "top_features": [
        {"feature": str, "value": float, "shap_contribution": float}, ...
      ]
    }
    """
    model, explainer, _schema = _load()
    X = build_features(history_rows, target_row)

    proba = float(model.predict_proba(X)[0][1])
    prediction = "anomalous" if proba >= 0.5 else "normal"

    sv = _anomaly_shap_row(explainer.shap_values(X))
    base_value = explainer.expected_value
    if hasattr(base_value, "__len__") and not isinstance(base_value, str):
        base_value = base_value[1] if len(base_value) > 1 else base_value[0]

    contributions = sorted(
        zip(X.columns, X.iloc[0].tolist(), sv.tolist()),
        key=lambda t: abs(t[2]),
        reverse=True,
    )[:top_n]

    return {
        "prediction": prediction,
        "probability": round(proba, 4),
        "base_value": round(float(base_value), 4),
        "top_features": [
            {
                "feature": feat,
                "value": round(float(val), 3),
                "shap_contribution": round(float(contrib), 4),
            }
            for feat, val, contrib in contributions
        ],
    }


GLOBAL_PATH = os.path.join(os.path.dirname(__file__), "pulsedc_global_importance.json")


def global_importance():
    """
    Overall feature importance for the dashboard's "how does the model decide?"
    card. Prefers the SHAP-based file exported by the Colab notebook
    (pulsedc_global_importance.json); if that file isn't there yet, falls back
    to the model's built-in feature importances so the card still works.

    Returns {"source": "shap" | "model", "features": [{"feature", "importance"}]}
    sorted from most to least important.
    """
    if os.path.exists(GLOBAL_PATH):
        with open(GLOBAL_PATH) as f:
            data = json.load(f)
        feats = sorted(data["features"], key=lambda d: d["importance"], reverse=True)
        return {"source": "shap", "features": feats}

    model, _explainer, schema = _load()
    feats = [
        {"feature": name, "importance": round(float(imp), 6)}
        for name, imp in zip(schema["feature_columns"], model.feature_importances_)
    ]
    feats.sort(key=lambda d: d["importance"], reverse=True)
    return {"source": "model", "features": feats}