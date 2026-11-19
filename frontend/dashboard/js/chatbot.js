/* CHATBOT WIDGET — floating bubble, connects to the Flask backend at
   http://127.0.0.1:5001. Conversation history is kept in-memory for the
   session (resets on page reload) and sent with every request so the
   backend/LLM has multi-turn context.

   Assistant replies are rendered as lightweight Markdown (bold, italics,
   inline code, bullet lists) since the LLM naturally writes in Markdown.
   User messages are always shown as plain escaped text — never rendered
   as Markdown/HTML — since that's untrusted local input. */

// API base is resolved centrally via PulseDC.API (core/utils.js, loaded first)
const CHAT_API_BASE = window.PulseDC.API.getBaseUrl();

function initChatbot() {
    const bubble = document.getElementById('chatBubble');
    const panel = document.getElementById('chatPanel');
    const expandBtn = document.getElementById('chatExpandBtn');
    const closeBtn = document.getElementById('chatCloseBtn');
    const messagesEl = document.getElementById('chatMessages');
    const form = document.getElementById('chatForm');
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('chatSendBtn');
    const statusEl = document.getElementById('chatStatus');
    const clearBtn = document.getElementById('chatClearBtn');
    const suggestionsEl = document.getElementById('chatSuggestions');
    const unreadBadge = document.getElementById('chatUnreadBadge');
    const confirmCard = document.getElementById('chatConfirmCard');
    const confirmPrompt = document.getElementById('chatConfirmPrompt');
    const confirmDetails = document.getElementById('chatConfirmDetails');
    const confirmPasscode = document.getElementById('chatConfirmPasscode');
    const confirmSubmitBtn = document.getElementById('chatConfirmSubmitBtn');
    const confirmCancelBtn = document.getElementById('chatConfirmCancelBtn');
    const confirmError = document.getElementById('chatConfirmError');
    const userBadge = document.getElementById('chatUserBadge');
    const panelSubtitle = document.getElementById('chatPanelSubtitle');

    let currentActionProposal = null;

    let history = []; // [{role: 'user'|'assistant', content: '...'}, ...]
    let isSending = false;
    let isMaximized = false;
    let customSize = { width: 380, height: 540, right: 24, bottom: 24 };

    // Get user-specific storage key so different accounts have isolated chat sessions
    function getUserStorageKey() {
        const username = window.PulseDC?.currentUser?.username || 'guest';
        return `pulse_dc_chatbot_history_${username}`;
    }

    const SIZE_STORAGE_KEY = 'pulse_dc_chatbot_panel_size';

    function loadSavedSize() {
        try {
            const stored = localStorage.getItem(SIZE_STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (parsed && parsed.width && parsed.height) {
                    customSize = {
                        width: Math.max(320, parsed.width),
                        height: Math.max(380, parsed.height),
                        right: parsed.right ?? 24,
                        bottom: parsed.bottom ?? 24
                    };
                }
            }
        } catch (e) {
            console.error('Failed to load saved chatbot panel size:', e);
        }
    }

    function applyCustomSize() {
        if (!panel || isMaximized) return;
        panel.style.width = `${customSize.width}px`;
        panel.style.height = `${customSize.height}px`;
        panel.style.right = `${customSize.right}px`;
        panel.style.bottom = `${customSize.bottom}px`;
    }

    function saveSize(w, h, r, b) {
        customSize = { width: w, height: h, right: r, bottom: b };
        try {
            localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify(customSize));
        } catch (e) { }
    }

    function scrollToBottom() {
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function toggleMaximize() {
        isMaximized = !isMaximized;
        if (panel) {
            panel.classList.toggle('maximized', isMaximized);
            if (!isMaximized) {
                applyCustomSize();
            } else {
                panel.style.width = '';
                panel.style.height = '';
                panel.style.right = '';
                panel.style.bottom = '';
            }
        }
        if (expandBtn) {
            expandBtn.textContent = isMaximized ? '🗗' : '🗖';
            expandBtn.title = isMaximized ? 'Restore window size' : 'Maximize window';
        }
        scrollToBottom();
    }

    if (expandBtn) {
        expandBtn.addEventListener('click', toggleMaximize);
    }

    // Double-click header bar to toggle Maximize / Restore
    const panelHeader = document.getElementById('chatPanelHeader');
    if (panelHeader) {
        panelHeader.addEventListener('dblclick', (e) => {
            if (!e.target.closest('.chat-header-btn') && !e.target.closest('.chat-close-btn')) {
                toggleMaximize();
            }
        });
    }

    // Drag Resizing Logic for 8 handles
    function initResizeHandles() {
        if (!panel) return;
        const handles = panel.querySelectorAll('.chat-resize-handle');
        handles.forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                if (isMaximized) return;
                e.preventDefault();
                e.stopPropagation();

                const dir = handle.dataset.dir;
                const startX = e.clientX;
                const startY = e.clientY;
                const startRect = panel.getBoundingClientRect();
                const startWidth = startRect.width;
                const startHeight = startRect.height;
                const startRight = window.innerWidth - startRect.right;
                const startBottom = window.innerHeight - startRect.bottom;

                panel.classList.add('resizing');

                let currentW = startWidth;
                let currentH = startHeight;
                let currentR = startRight;
                let currentB = startBottom;

                function onMouseMove(moveEvt) {
                    const deltaX = moveEvt.clientX - startX;
                    const deltaY = moveEvt.clientY - startY;

                    currentW = startWidth;
                    currentH = startHeight;
                    currentR = startRight;
                    currentB = startBottom;

                    if (dir.includes('w')) {
                        currentW = Math.max(320, Math.min(window.innerWidth - startRight - 12, startWidth - deltaX));
                    } else if (dir.includes('e')) {
                        const rawWidth = startWidth + deltaX;
                        currentW = Math.max(320, Math.min(window.innerWidth - 12, rawWidth));
                        const actualDeltaX = currentW - startWidth;
                        currentR = Math.max(12, startRight - actualDeltaX);
                    }

                    if (dir.includes('n')) {
                        currentH = Math.max(380, Math.min(window.innerHeight - startBottom - 12, startHeight - deltaY));
                    } else if (dir.includes('s')) {
                        const rawHeight = startHeight + deltaY;
                        currentH = Math.max(380, Math.min(window.innerHeight - 12, rawHeight));
                        const actualDeltaY = currentH - startHeight;
                        currentB = Math.max(12, startBottom - actualDeltaY);
                    }

                    panel.style.width = `${currentW}px`;
                    panel.style.height = `${currentH}px`;
                    panel.style.right = `${currentR}px`;
                    panel.style.bottom = `${currentB}px`;

                    scrollToBottom();
                }

                function onMouseUp() {
                    panel.classList.remove('resizing');
                    saveSize(currentW, currentH, currentR, currentB);
                    window.removeEventListener('mousemove', onMouseMove);
                    window.removeEventListener('mouseup', onMouseUp);
                }

                window.addEventListener('mousemove', onMouseMove);
                window.addEventListener('mouseup', onMouseUp);
            });
        });
    }

    // Drag Header to Move Window (Drag & Drop)
    function initHeaderDrag() {
        if (!panelHeader || !panel) return;

        panelHeader.addEventListener('mousedown', (e) => {
            if (isMaximized) return;
            // Prevent drag when clicking buttons inside the header
            if (e.target.closest('.chat-header-btn') || e.target.closest('.chat-close-btn')) {
                return;
            }

            e.preventDefault();
            const startX = e.clientX;
            const startY = e.clientY;
            const startRect = panel.getBoundingClientRect();
            const startRight = window.innerWidth - startRect.right;
            const startBottom = window.innerHeight - startRect.bottom;

            panel.classList.add('dragging');

            let currentR = startRight;
            let currentB = startBottom;

            function onMouseMove(moveEvt) {
                const deltaX = moveEvt.clientX - startX;
                const deltaY = moveEvt.clientY - startY;

                // Move horizontally: moving mouse right decreases 'right' CSS offset
                const maxR = Math.max(12, window.innerWidth - startRect.width - 12);
                currentR = Math.max(12, Math.min(maxR, startRight - deltaX));

                // Move vertically: moving mouse down decreases 'bottom' CSS offset
                const maxB = Math.max(12, window.innerHeight - 60);
                currentB = Math.max(12, Math.min(maxB, startBottom - deltaY));

                panel.style.right = `${currentR}px`;
                panel.style.bottom = `${currentB}px`;
            }

            function onMouseUp() {
                panel.classList.remove('dragging');
                saveSize(customSize.width, customSize.height, currentR, currentB);
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            }

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    loadSavedSize();
    applyCustomSize();
    initResizeHandles();
    initHeaderDrag();

    const escapeHtml = window.PulseDC.Utils.escapeHtml;

    function persistHistory() {
        try {
            sessionStorage.setItem(getUserStorageKey(), JSON.stringify(history));
        } catch (e) {
            console.error('Failed to persist chat history:', e);
        }
    }

    function loadPersistedHistory() {
        try {
            const stored = sessionStorage.getItem(getUserStorageKey());
            if (stored) {
                history = JSON.parse(stored);
                if (history.length > 0) {
                    messagesEl.innerHTML = '';
                    history.forEach(msg => {
                        appendMessage(msg.role, msg.content, true); // skip persisting again
                    });
                    if (suggestionsEl) suggestionsEl.style.display = 'none';
                    return true;
                }
            }
        } catch (e) {
            console.error('Failed to load persisted chat history:', e);
        }
        return false;
    }

    function clearChat() {
        history = [];
        try {
            sessionStorage.removeItem(getUserStorageKey());
        } catch (e) { }
        messagesEl.innerHTML = '';
        if (suggestionsEl) suggestionsEl.style.display = 'flex';
        setStatus('');
        renderWelcomeMessage();
    }

    function renderWelcomeMessage() {
        const u = window.PulseDC?.currentUser;
        if (u && u.role === 'super_admin') {
            appendMessage('assistant', `👋 Welcome **${u.display_name}**! You are logged in with **Super Admin** privileges. You can ask about site operations or request direct system modifications for any facility or fleet-wide (e.g. *"Change flow rate on DC-Alpha to 28"* or *"Change temperature for all facilities"*).`, true);
        } else if (u && u.role === 'admin') {
            appendMessage('assistant', `👋 Hello **${u.display_name}**! You are logged in as **Admin**. You can query facility metrics, review alerts, and adjust thresholds for specific facilities (e.g. *"Change humidity on DC-Alpha to 30"*).`, true);
        } else {
            appendMessage('assistant', "Hi! I'm the Pulse DC assistant. Ask me about site health, alerts, or any sensor across your data centers.", true);
        }
    }

    function updateChatUserContext(user) {
        if (!user) return;
        if (userBadge) {
            if (user.role === 'super_admin') {
                userBadge.textContent = 'Super Admin';
                userBadge.className = 'chat-user-badge super-admin';
                userBadge.style.display = 'inline-block';
            } else if (user.role === 'admin') {
                userBadge.textContent = 'Admin';
                userBadge.className = 'chat-user-badge';
                userBadge.style.display = 'inline-block';
            } else {
                userBadge.style.display = 'none';
            }
        }

        // Re-load this user's specific history
        messagesEl.innerHTML = '';
        const restored = loadPersistedHistory();
        if (!restored) {
            renderWelcomeMessage();
        }
    }

    // Expose to window so auth/main can switch users dynamically
    window.PulseDC = window.PulseDC || {};
    window.PulseDC.updateChatUserContext = updateChatUserContext;

    if (clearBtn) {
        clearBtn.addEventListener('click', clearChat);
    }

    // Advanced Markdown -> HTML converter: parses bold, italic, code blocks,
    // headers, tables, action buttons, and applies badge tags to key terms.
    function renderMarkdown(rawText) {
        // Action links like [label](action:navigate:drilldown?client=1&dc=2)
        // must be extracted from the RAW text, before HTML-escaping. If we
        // escaped first, a multi-param query string's "&" would become
        // "&amp;" and no longer match the action-link pattern below, so
        // links with more than one query param would silently fail to
        // render as buttons. Instead: pull them out now, replace with a
        // safe placeholder token (Unicode Private Use chars that can't
        // appear in normal text or get mangled by escaping/markdown), and
        // splice the real button HTML back in at the very end.
        const actionButtons = [];
        const textWithPlaceholders = rawText.replace(
            /\[([^\]]+)\]\((action:[^)\r\n]+)\)/g,
            (match, label, action) => {
                const idx = actionButtons.length;
                // label still needs HTML-escaping since it's user/LLM-controlled text
                const safeLabel = label
                    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                actionButtons.push(`<button class="chat-action-btn" data-action="${action}">${safeLabel}</button>`);
                return `\uE000${idx}\uE001`;
            }
        );

        const escaped = escapeHtml(textWithPlaceholders);
        const lines = escaped.replace(/\r\n/g, '\n').split('\n').map(l => l.replace(/\s+$/, ''));
        const htmlParts = [];
        let inList = false;
        let inTable = false;
        let inCodeBlock = false;
        let codeLines = [];
        let tableHeaderProcessed = false;

        function inlineFormat(line) {
            let formatted = line;

            // 0. Line breaks (convert &lt;br&gt; back to real HTML line breaks inside table cells)
            formatted = formatted.replace(/&lt;br\s*\/?&gt;/gi, '<br>');

            // 1. Bold
            formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

            // 2. Italic
            formatted = formatted.replace(/(^|[^*])\*(?!\*)(.+?)\*(?!\*)/g, '$1<em>$2</em>');

            // 3. Inline Code
            formatted = formatted.replace(/`(.+?)`/g, '<code>$1</code>');

            // 4. Status badge styling (ignoring occurrences inside HTML tags/attributes)
            formatted = formatted.replace(/\b(critical|anomaly|alert|danger)\b(?![^<>]*>)/gi, '<span class="badge alert">$1</span>');
            formatted = formatted.replace(/\b(warning|watch)\b(?![^<>]*>)/gi, '<span class="badge watch">$1</span>');
            formatted = formatted.replace(/\b(normal|stable|resolved|healthy|ok)\b(?![^<>]*>)/gi, '<span class="badge normal">$1</span>');

            return formatted;
        }

        for (let i = 0; i < lines.length; i++) {
            const rawLine = lines[i];
            const line = rawLine.trimStart();

            // Code blocks: ```
            if (line.startsWith('```')) {
                if (inCodeBlock) {
                    htmlParts.push(`<pre class="chat-code-block"><code>${codeLines.join('\n')}</code></pre>`);
                    inCodeBlock = false;
                    codeLines = [];
                } else {
                    inCodeBlock = true;
                }
                continue;
            }

            if (inCodeBlock) {
                codeLines.push(rawLine);
                continue;
            }

            // Tables: | col | col |
            const isTableLine = line.startsWith('|') && line.endsWith('|');
            if (isTableLine) {
                if (inList) { htmlParts.push('</ul>'); inList = false; }
                if (!inTable) {
                    htmlParts.push('<table class="chat-md-table">');
                    inTable = true;
                    tableHeaderProcessed = false;
                }
                if (line.match(/^\|[|:\-\s]+\|$/)) {
                    continue; // Skip table header separator row
                }
                const cols = rawLine.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
                htmlParts.push('<tr>');
                cols.forEach(col => {
                    if (!tableHeaderProcessed) {
                        htmlParts.push(`<th>${inlineFormat(col)}</th>`);
                    } else {
                        htmlParts.push(`<td>${inlineFormat(col)}</td>`);
                    }
                });
                htmlParts.push('</tr>');
                if (!tableHeaderProcessed) {
                    tableHeaderProcessed = true;
                }
                continue;
            } else {
                if (inTable) {
                    htmlParts.push('</table>');
                    inTable = false;
                }
            }

            // List items: - or * or •
            const bulletMatch = line.match(/^[-*•]\s+(.*)$/);
            if (bulletMatch) {
                if (!inList) { htmlParts.push('<ul class="chat-md-list">'); inList = true; }
                htmlParts.push(`<li>${inlineFormat(bulletMatch[1])}</li>`);
                continue;
            } else {
                if (inList) { htmlParts.push('</ul>'); inList = false; }
            }

            // Headers: #, ##, ###, ####, #####, ######
            const headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
            if (headerMatch) {
                const level = headerMatch[1].length;
                const tagLevel = Math.min(level + 1, 6);
                htmlParts.push(`<h${tagLevel} class="chat-md-h${level}">${inlineFormat(headerMatch[2])}</h${tagLevel}>`);
                continue;
            }

            // Paragraph / newlines
            if (line === '') {
                htmlParts.push('<br>');
            } else {
                htmlParts.push(`<div>${inlineFormat(rawLine)}</div>`);
            }
        }

        if (inCodeBlock) {
            htmlParts.push(`<pre class="chat-code-block"><code>${codeLines.join('\n')}</code></pre>`);
        }
        if (inTable) htmlParts.push('</table>');
        if (inList) htmlParts.push('</ul>');

        let result = htmlParts.join('');

        // Splice the real action-button HTML back in, replacing the
        // placeholder tokens inserted at the very start of this function.
        result = result.replace(/\uE000(\d+)\uE001/g, (match, idx) => actionButtons[Number(idx)] || '');

        return result;
    }

    function appendMessage(role, text, skipPersist = false) {
        const row = document.createElement('div');
        row.className = `chat-msg chat-msg-${role}`;
        const bubbleEl = document.createElement('div');
        bubbleEl.className = 'chat-bubble-text';
        if (role === 'assistant') {
            bubbleEl.innerHTML = renderMarkdown(text);
        } else {
            bubbleEl.textContent = text;
        }
        row.appendChild(bubbleEl);
        messagesEl.appendChild(row);
        scrollToBottom();

        if (!skipPersist && (role === 'user' || role === 'assistant')) {
            history.push({ role, content: text });
            persistHistory();
        }

        // Show the unread badge on the bubble when an assistant message
        // arrives while the chat panel is not visible to the user.
        if (role === 'assistant' && !panel.classList.contains('open') && unreadBadge) {
            unreadBadge.classList.add('visible');
        }

        return row;
    }

    function appendTyping() {
        const row = document.createElement('div');
        row.className = 'chat-msg chat-msg-assistant chat-msg-typing';
        row.id = 'chatTypingIndicator';
        row.innerHTML = `<div class="chat-bubble-text"><span class="chat-dot"></span><span class="chat-dot"></span><span class="chat-dot"></span> Reviewing telemetry and alerts…</div>`;
        messagesEl.appendChild(row);
        scrollToBottom();
    }

    function removeTyping() {
        const el = document.getElementById('chatTypingIndicator');
        if (el) el.remove();
    }

    function setStatus(text, isError) {
        statusEl.textContent = text || '';
        statusEl.classList.toggle('chat-status-error', !!isError);
    }

    function openPanel() {
        panel.classList.add('open');
        bubble.classList.add('hidden-while-open');
        // Clear the unread badge when user opens the panel
        if (unreadBadge) unreadBadge.classList.remove('visible');
        input.focus();
    }
    function closePanel() {
        panel.classList.remove('open');
        bubble.classList.remove('hidden-while-open');
    }

    bubble.addEventListener('click', openPanel);
    closeBtn.addEventListener('click', closePanel);

    function getScreenContext() {
        try {
            const activeNav = document.querySelector('.nav-item.active');
            const pageId = activeNav ? activeNav.dataset.page : (document.querySelector('.page.active')?.id?.replace('page-', '') || 'overview');

            const lines = ['[DASHBOARD CONTEXT]', `Current Page: ${pageId}`];

            if (pageId === 'overview') {
                const totalSites = document.getElementById('ovTotalSites')?.textContent?.trim();
                const totalClients = document.getElementById('ovTotalClients')?.textContent?.trim();
                const activeAlerts = document.getElementById('ovActiveAlerts')?.textContent?.trim();
                const healthySites = document.getElementById('ovHealthySites')?.textContent?.trim();
                const statusPill = document.getElementById('sysStatusPill')?.textContent?.trim();

                lines.push(`System Status: ${statusPill || 'Normal'}`);
                lines.push(`Overview Stats: Total Sites: ${totalSites || '-'}, Clients: ${totalClients || '-'}, Active Alerts: ${activeAlerts || '0'}, Healthy Sites: ${healthySites || '-'}`);

                const alertCards = Array.from(document.querySelectorAll('#siteGrid .site-card.alert, #siteGrid .site-card.attention'));
                if (alertCards.length > 0) {
                    const alertSiteNames = alertCards.map(c => c.querySelector('.site-name')?.textContent?.trim() || c.textContent?.trim()).filter(Boolean);
                    lines.push(`Sites Needing Attention: ${alertSiteNames.join(', ')}`);
                }
            } else if (pageId === 'drilldown') {
                const clientSel = document.getElementById('clientSelect');
                const dcSel = document.getElementById('dcSelect');
                const roomSel = document.getElementById('roomSelect');
                const clientText = clientSel?.selectedOptions[0]?.text?.trim() || clientSel?.value;
                const dcText = dcSel?.selectedOptions[0]?.text?.trim() || dcSel?.value;
                const roomText = roomSel?.selectedOptions[0]?.text?.trim() || roomSel?.value;
                const dcStatus = document.getElementById('dcStatusPill')?.textContent?.trim() || 'Normal';
                const dcLocation = document.getElementById('dcLocation')?.textContent?.trim();
                const roomMeta = document.getElementById('roomMeta')?.textContent?.trim();

                lines.push(`Selected Client: ${clientText || '-'}`);
                lines.push(`Selected Data Center: ${dcText || '-'} (Status: ${dcStatus})`);
                if (dcLocation) lines.push(`Location / Room Info: ${dcLocation} | ${roomMeta || ''}`);
                lines.push(`Selected Room: ${roomText || '-'}`);

                const rows = Array.from(document.querySelectorAll('#metricTableBody tr.row-clickable'));
                if (rows.length > 0) {
                    const sensorSummaries = rows.map(r => {
                        const name = r.querySelector('.metric-name')?.childNodes[0]?.textContent?.trim() || 'Sensor';
                        const val = r.querySelector('.metric-val')?.textContent?.trim() || '';
                        const badge = r.querySelector('.badge')?.textContent?.trim() || 'Normal';
                        const trend = r.querySelector('.trend-val')?.textContent?.trim() || '';
                        return `${name}: ${val} (${badge}${trend ? ', ' + trend : ''})`;
                    });
                    lines.push(`Sensors in Room: ${sensorSummaries.join('; ')}`);
                }
            } else if (pageId === 'compare') {
                const activeModeBtn = document.querySelector('#compareModeTabs .metric-tab.active');
                const modeText = activeModeBtn?.textContent?.trim() || 'Across Sites';
                lines.push(`Compare Mode: ${modeText}`);

                const activeMetricBtn = document.querySelector('#compareTabs .metric-tab.active');
                if (activeMetricBtn) {
                    lines.push(`Metric: ${activeMetricBtn.textContent.trim()}`);
                }

                const roomSel = document.getElementById('compareRoomSelect');
                if (roomSel && roomSel.style.display !== 'none' && roomSel.selectedOptions[0]) {
                    lines.push(`Selected Room A: ${roomSel.selectedOptions[0].text.trim()}`);
                }
                const roomSelB = document.getElementById('compareRoomSelectB');
                if (roomSelB && roomSelB.style.display !== 'none' && roomSelB.selectedOptions[0]) {
                    lines.push(`Selected Room B: ${roomSelB.selectedOptions[0].text.trim()}`);
                }

                const activeLegendChips = Array.from(document.querySelectorAll('#compareLegend .legend-chip.active')).map(c => c.textContent.trim());
                if (activeLegendChips.length > 0) {
                    lines.push(`Visible Data Centers in Chart: ${activeLegendChips.join(', ')}`);
                }

                const summaryText = document.getElementById('compareSummary')?.textContent?.trim();
                if (summaryText) lines.push(`Summary: ${summaryText}`);
            } else if (pageId === 'forecast') {
                const fcTitle = document.getElementById('fcTitle')?.textContent?.trim();
                const fcMeta = document.getElementById('fcMeta')?.textContent?.trim();
                if (fcTitle) lines.push(`Inspecting Site: ${fcTitle} (${fcMeta || ''})`);

                const statBoxes = Array.from(document.querySelectorAll('#fcStatGrid .stat-box2'));
                if (statBoxes.length > 0) {
                    const stats = statBoxes.map(b => `${b.querySelector('.label')?.textContent?.trim()}: ${b.querySelector('.value')?.textContent?.trim()}`).join(', ');
                    lines.push(`Selected Sensor Stats: ${stats}`);
                }

                const rankRows = Array.from(document.querySelectorAll('#rankList .rank-row'));
                if (rankRows.length > 0) {
                    const ranked = rankRows.map(r => {
                        const name = r.querySelector('.rank-name')?.textContent?.trim() || '';
                        const badge = r.querySelector('.badge')?.textContent?.trim() || '';
                        return `${name} (${badge})`;
                    });
                    lines.push(`Site Risk Rankings: ${ranked.join(', ')}`);
                }
            } else if (pageId === 'alerts') {
                const activeFilterBtn = document.querySelector('#alertFilters .filter-btn.active');
                const filter = activeFilterBtn?.textContent?.trim() || 'All';
                const crit = document.getElementById('countCritical')?.textContent?.trim() || '0';
                const warn = document.getElementById('countWarning')?.textContent?.trim() || '0';
                const res = document.getElementById('countResolved')?.textContent?.trim() || '0';

                lines.push(`Alert Counts: Critical: ${crit}, Warning: ${warn}, Resolved: ${res}`);
                lines.push(`Active Filter: ${filter}`);

                const alertRows = Array.from(document.querySelectorAll('#alertFeed .alert-row')).slice(0, 8);
                if (alertRows.length > 0) {
                    const alertList = alertRows.map(row => {
                        const sev = row.querySelector('.sev-badge')?.textContent?.trim() || '';
                        const title = row.querySelector('.alert-title')?.textContent?.trim() || '';
                        const val = row.querySelector('.alert-value')?.textContent?.trim() || '';
                        return `[${sev}] ${title} (${val})`;
                    });
                    lines.push(`Visible Alerts (top ${alertRows.length}): ${alertList.join('; ')}`);
                }
            }

            lines.push('[END CONTEXT]');
            return lines.join('\n');
        } catch (e) {
            console.error('Error generating screen context:', e);
            return '';
        }
    }

    async function sendMessage(text) {
        if (isSending) return;
        isSending = true;
        sendBtn.disabled = true;
        setStatus('');

        if (suggestionsEl) suggestionsEl.style.display = 'none';

        appendMessage('user', text);
        appendTyping();

        const screenContext = getScreenContext();
        const fullMessage = screenContext ? `${screenContext}\n\n${text}` : text;

        const activeNav = document.querySelector('.nav-item.active');
        const activeTab = activeNav ? activeNav.dataset.page : (document.querySelector('.page.active')?.id?.replace('page-', '') || 'overview');
        const selectedDc = document.getElementById('dcSelect')?.selectedOptions[0]?.text || document.getElementById('fcTitle')?.textContent || 'All';
        const selectedMetric = document.querySelector('#compareTabs .metric-tab.active')?.textContent || 'All';

        const uiContext = {
            active_tab: activeTab,
            selected_dc: selectedDc,
            selected_metric: selectedMetric
        };

        try {
            const userRole = window.PulseDC?.currentUser?.role;

            // Route both Super Admin and Admin to the Google ADK Agent.
            // - Super Admin can change single facilities and fleet-wide defaults.
            // - Admin can change single facilities (fleet-wide changes are politely blocked).
            if (userRole === 'super_admin' || userRole === 'admin') {
                const res = await fetch(`${CHAT_API_BASE}/api/admin/agent/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ message: text })
                });

                removeTyping();

                if (!res.ok) {
                    const errBody = await res.json().catch(() => ({}));
                    appendMessage('assistant', `Error processing request: ${errBody.error || res.statusText}`);
                    return;
                }

                const data = await res.json();
                if (data.status === 'requires_confirmation') {
                    appendMessage('assistant', data.message || "I have prepared the requested change. Please confirm to proceed.");
                    showConfirmModal(data);
                    return;
                } else if (data.content) {
                    appendMessage('assistant', data.content);
                    return;
                }
            }

            // For Client users, route to standard monitoring assistant
            const res = await fetch(`${CHAT_API_BASE}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ message: fullMessage, history: history.slice(0, -1), ui_context: uiContext })
            });

            removeTyping();

            if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                const errMsg = errBody.error || `Request failed (${res.status})`;
                appendMessage('assistant', `Sorry, something went wrong: ${errMsg}`);
                setStatus('Could not reach the assistant backend.', true);
                return;
            }

            const data = await res.json();
            appendMessage('assistant', data.reply);
        } catch (err) {
            removeTyping();
            appendMessage('assistant', "Sorry, I couldn't reach the backend. Is the Flask server running on port 5001?");
            setStatus('Backend unreachable — check that python app.py is running.', true);
        } finally {
            isSending = false;
            sendBtn.disabled = false;
        }
    }

    function showConfirmModal(proposal) {
        currentActionProposal = proposal;
        if (!confirmCard) return;

        confirmPrompt.textContent = proposal.prompt_dialog || "Are you sure you would like to apply this modification?";
        const d = proposal.details || {};
        confirmDetails.innerHTML = `
            <strong>Target Facility:</strong> ${d.facility || 'Fleet'}<br>
            <strong>Metric:</strong> ${d.metric || 'General'}<br>
            <strong>Proposed Values:</strong> Min: ${d.min ?? 'Unchanged'} | Max: ${d.max ?? 'Unchanged'}
        `;

        if (confirmPasscode) {
            confirmPasscode.value = '';
            confirmPasscode.disabled = false;
        }
        if (confirmError) {
            confirmError.textContent = '';
            confirmError.style.display = 'none';
        }
        if (confirmSubmitBtn) confirmSubmitBtn.disabled = false;
        if (confirmCancelBtn) confirmCancelBtn.disabled = false;

        confirmCard.style.display = 'flex';
        confirmPasscode.focus();
        scrollToBottom();
    }

    function hideConfirmModal() {
        if (confirmCard) confirmCard.style.display = 'none';
        currentActionProposal = null;
        if (confirmPasscode) confirmPasscode.value = '';
    }

    if (confirmCancelBtn) {
        confirmCancelBtn.addEventListener('click', () => {
            hideConfirmModal();
            appendMessage('assistant', "Action cancelled. No modifications were made to the system.");
        });
    }

    if (confirmSubmitBtn) {
        confirmSubmitBtn.addEventListener('click', async () => {
            if (!currentActionProposal) return;
            const code = confirmPasscode ? confirmPasscode.value.trim() : '';
            if (!code) {
                if (confirmError) {
                    confirmError.textContent = 'Please enter your admin passcode to proceed.';
                    confirmError.style.display = 'block';
                }
                return;
            }

            confirmSubmitBtn.disabled = true;
            confirmCancelBtn.disabled = true;
            confirmPasscode.disabled = true;
            if (confirmError) confirmError.style.display = 'none';

            try {
                const res = await fetch(`${CHAT_API_BASE}/api/admin/agent/confirm`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        action_id: currentActionProposal.action_id,
                        passcode: code
                    })
                });

                const data = await res.json();
                if (!res.ok || data.status === 'error') {
                    if (confirmError) {
                        confirmError.textContent = data.message || data.error || 'Verification failed.';
                        confirmError.style.display = 'block';
                    }
                    confirmSubmitBtn.disabled = false;
                    confirmCancelBtn.disabled = false;
                    confirmPasscode.disabled = false;
                    confirmPasscode.focus();
                    return;
                }

                // Success!
                hideConfirmModal();
                appendMessage('assistant', data.ai_message || "Action confirmed and applied.");

                // Trigger live dashboard and operating limits refresh so UI immediately reflects updated limits
                try {
                    if (window.PulseDC?.loadThresholdSettings) {
                        await window.PulseDC.loadThresholdSettings();
                    }
                    if (window.PulseDC?.refreshDashboard) {
                        await window.PulseDC.refreshDashboard();
                    }
                } catch (refreshErr) {
                    console.warn("Soft refresh failed, reloading view:", refreshErr);
                }

                // If currently viewing Operating Limits page or if user prefers instant sync, refresh the limits view
                const activePage = document.querySelector('.page.active');
                if (activePage && activePage.id === 'page-thresholds' && window.PulseDC?.loadThresholdSettings) {
                    window.PulseDC.loadThresholdSettings();
                }
            } catch (err) {
                if (confirmError) {
                    confirmError.textContent = 'Network or server error while executing action.';
                    confirmError.style.display = 'block';
                }
                confirmSubmitBtn.disabled = false;
                confirmCancelBtn.disabled = false;
                confirmPasscode.disabled = false;
            }
        });
    }

    // Submit confirm on Enter key in passcode field
    if (confirmPasscode) {
        confirmPasscode.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirmSubmitBtn.click();
            }
        });
    }

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        sendMessage(text);
    });

    // Wire up suggestion chip clicks
    if (suggestionsEl) {
        suggestionsEl.querySelectorAll('.chat-suggest-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const query = chip.dataset.query;
                if (query) {
                    sendMessage(query);
                }
            });
        });
    }

    // Deep linking action runner
    function executeChatAction(actionStr) {
        if (!actionStr || !actionStr.startsWith('action:')) return;
        const parts = actionStr.substring(7).split('?');
        const actionType = parts[0];
        const queryStr = parts[1] || '';
        const params = new URLSearchParams(queryStr);

        if (actionType === 'navigate:drilldown') {
            const rawClient = params.get('client');
            const rawDc = params.get('dc');
            const rawRoom = params.get('room');

            let clientId = rawClient;
            let dcId = rawDc;
            let roomId = rawRoom;

            // Resolve name or text to numeric ID if data centers exist in global D
            if (window.D) {
                if (rawDc && window.D.data_centers) {
                    const dcMatch = window.D.data_centers.find(d =>
                        String(d.id) === String(rawDc) ||
                        d.name.toLowerCase().replace(/[-_\s]/g, '').includes(rawDc.toLowerCase().replace(/[-_\s]/g, ''))
                    );
                    if (dcMatch) {
                        dcId = dcMatch.id;
                        if (!clientId) clientId = dcMatch.client_id;
                    }
                }
                if (rawClient && window.D.clients) {
                    const clientMatch = window.D.clients.find(c =>
                        String(c.id) === String(rawClient) ||
                        c.company_name.toLowerCase().includes(rawClient.toLowerCase())
                    );
                    if (clientMatch) clientId = clientMatch.id;
                }
                if (rawRoom && window.D.rooms) {
                    const roomMatch = window.D.rooms.find(r =>
                        (dcId ? r.data_center_id === Number(dcId) : true) &&
                        (String(r.id) === String(rawRoom) || r.room_code.toLowerCase() === rawRoom.toLowerCase() || r.name.toLowerCase().includes(rawRoom.toLowerCase()))
                    );
                    if (roomMatch) roomId = roomMatch.id;
                }
            }

            if (window.gotoDrilldown && clientId && dcId) {
                window.gotoDrilldown(clientId, dcId, roomId);
            } else {
                // Manual fallback navigation
                const navItem = document.querySelector('.nav-item[data-page="drilldown"]');
                if (navItem) navItem.click();

                const clientSelect = document.getElementById('clientSelect');
                const dcSelect = document.getElementById('dcSelect');
                const roomSelect = document.getElementById('roomSelect');

                if (clientSelect && clientId) {
                    clientSelect.value = clientId;
                    clientSelect.dispatchEvent(new Event('change'));
                    setTimeout(() => {
                        if (dcSelect && dcId) {
                            dcSelect.value = dcId;
                            dcSelect.dispatchEvent(new Event('change'));
                            setTimeout(() => {
                                if (roomSelect && roomId) {
                                    roomSelect.value = roomId;
                                    roomSelect.dispatchEvent(new Event('change'));
                                }
                            }, 50);
                        }
                    }, 50);
                }
            }
            closePanel();
        } else if (actionType === 'navigate:compare') {
            const navItem = document.querySelector('.nav-item[data-page="compare"]');
            if (navItem) navItem.click();

            const metric = params.get('metric');
            const mode = params.get('mode');
            const roomId = params.get('room');

            if (mode) {
                const modeBtn = document.querySelector(`#page-compare button[data-mode="${mode}"]`);
                if (modeBtn) modeBtn.click();
            }

            if (metric) {
                setTimeout(() => {
                    const tab = document.querySelector(`#page-compare button[data-metric="${metric}"]`);
                    if (tab) tab.click();
                }, 50);
            }

            if (mode === 'within' && roomId) {
                setTimeout(() => {
                    const roomSelect = document.getElementById('compareRoomSelect');
                    if (roomSelect) {
                        roomSelect.value = roomId;
                        roomSelect.dispatchEvent(new Event('change'));
                    }
                }, 100);
            }
            closePanel();
        } else if (actionType === 'navigate:forecast') {
            const navItem = document.querySelector('.nav-item[data-page="forecast"]');
            if (navItem) navItem.click();
            closePanel();
        } else if (actionType === 'navigate:alerts') {
            const navItem = document.querySelector('.nav-item[data-page="alerts"]');
            if (navItem) navItem.click();
            closePanel();
        }
    }

    // Expose deep linking action handler globally for clicks and console testing
    window.executeChatAction = executeChatAction;

    // Listen to action clicks inside messages
    messagesEl.addEventListener('click', (e) => {
        const actionBtn = e.target.closest('.chat-action-btn');
        if (actionBtn) {
            e.preventDefault();
            const actionStr = actionBtn.dataset.action;
            executeChatAction(actionStr);
        }
    });

    // Load persisted history, or display welcome message if empty
    const restored = loadPersistedHistory();
    if (!restored) {
        renderWelcomeMessage();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initChatbot();
});