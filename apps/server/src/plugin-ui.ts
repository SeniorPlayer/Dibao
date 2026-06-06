export const pluginUiCss = `
:root {
  color-scheme: light;
  --dibao-plugin-canvas: #f7f4ed;
  --dibao-plugin-surface: #fffefa;
  --dibao-plugin-paper: #f1eee6;
  --dibao-plugin-line: #d8d6ca;
  --dibao-plugin-line-soft: #e9e5da;
  --dibao-plugin-ink: #202421;
  --dibao-plugin-muted: #6d716b;
  --dibao-plugin-pine: #315f72;
  --dibao-plugin-pine-soft: #dce8ec;
  --dibao-plugin-danger: #a64235;
  --dibao-plugin-danger-soft: #edd8d4;
  --dibao-plugin-radius: 8px;
  --dibao-plugin-space-1: 4px;
  --dibao-plugin-space-2: 8px;
  --dibao-plugin-space-3: 12px;
  --dibao-plugin-space-4: 16px;
  --dibao-plugin-space-5: 20px;
  --dibao-plugin-space-6: 24px;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC",
    "PingFang SC", sans-serif;
}

* {
  box-sizing: border-box;
}

html,
body {
  min-height: 100%;
}

body.dibao-plugin {
  margin: 0;
  background: var(--dibao-plugin-canvas);
  color: var(--dibao-plugin-ink);
}

.dibao-plugin button,
.dibao-plugin input,
.dibao-plugin select,
.dibao-plugin textarea {
  font: inherit;
}

.dibao-plugin a {
  color: var(--dibao-plugin-pine);
  font-weight: 700;
  text-decoration: none;
}

.dibao-plugin a:hover {
  text-decoration: underline;
}

.dibao-plugin [hidden] {
  display: none !important;
}

.dibao-plugin .page,
.dibao-plugin .shell {
  width: 100%;
}

.dibao-plugin .page {
  min-height: 100vh;
  padding: var(--dibao-plugin-space-5);
}

.dibao-plugin .shell {
  display: grid;
  gap: var(--dibao-plugin-space-4);
  max-width: 1120px;
  margin: 0 auto;
}

body.dibao-plugin > .shell {
  min-height: 100vh;
  padding: var(--dibao-plugin-space-5);
}

.dibao-plugin .toolbar,
.dibao-plugin .header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--dibao-plugin-space-4);
  border: 1px solid var(--dibao-plugin-line);
  border-radius: var(--dibao-plugin-radius);
  padding: var(--dibao-plugin-space-5);
  background: var(--dibao-plugin-surface);
}

.dibao-plugin .kicker {
  margin: 0 0 var(--dibao-plugin-space-1);
  color: var(--dibao-plugin-muted);
  font-size: 12px;
  font-weight: 750;
  letter-spacing: 0;
  text-transform: none;
}

.dibao-plugin h1,
.dibao-plugin h2,
.dibao-plugin h3,
.dibao-plugin p {
  margin-top: 0;
}

.dibao-plugin h1 {
  margin-bottom: var(--dibao-plugin-space-1);
  font-size: 22px;
  line-height: 1.25;
}

.dibao-plugin h2 {
  margin-bottom: var(--dibao-plugin-space-3);
  font-size: 16px;
  line-height: 1.3;
}

.dibao-plugin h3 {
  margin-bottom: var(--dibao-plugin-space-2);
  font-size: 14px;
  line-height: 1.35;
}

.dibao-plugin .header p,
.dibao-plugin .settings p,
.dibao-plugin .empty p,
.dibao-plugin .muted,
.dibao-plugin .meta,
.dibao-plugin .status,
.dibao-plugin .topic-meta {
  color: var(--dibao-plugin-muted);
}

.dibao-plugin .muted,
.dibao-plugin .meta,
.dibao-plugin .status,
.dibao-plugin .topic-meta {
  font-size: 13px;
  line-height: 1.5;
}

.dibao-plugin .actions,
.dibao-plugin .tabs,
.dibao-plugin .history,
.dibao-plugin .article-actions,
.dibao-plugin .checks,
.dibao-plugin .chip-list,
.dibao-plugin .row-actions {
  display: flex;
  align-items: center;
  gap: var(--dibao-plugin-space-2);
  flex-wrap: wrap;
}

.dibao-plugin .tabs,
.dibao-plugin .history {
  margin: 0;
  overflow-x: auto;
  padding-bottom: 2px;
}

.dibao-plugin .button {
  min-height: 38px;
  border: 1px solid var(--dibao-plugin-line);
  border-radius: 6px;
  background: var(--dibao-plugin-surface);
  color: var(--dibao-plugin-muted);
  cursor: pointer;
  padding: 0 var(--dibao-plugin-space-3);
  font-size: 13px;
  font-weight: 750;
}

.dibao-plugin .button.primary,
.dibao-plugin .button.active,
.dibao-plugin .rule-row.active {
  border-color: var(--dibao-plugin-pine);
  background: var(--dibao-plugin-pine-soft);
  color: var(--dibao-plugin-pine);
}

.dibao-plugin .button.danger {
  border-color: var(--dibao-plugin-danger);
  color: var(--dibao-plugin-danger);
}

.dibao-plugin .button:disabled {
  cursor: progress;
  opacity: 0.65;
}

.dibao-plugin .layout {
  display: grid;
  grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
  gap: var(--dibao-plugin-space-4);
}

.dibao-plugin .panel,
.dibao-plugin .settings,
.dibao-plugin .empty,
.dibao-plugin .group,
.dibao-plugin .topic-family,
.dibao-plugin .rule-row,
.dibao-plugin .delivery-row {
  border: 1px solid var(--dibao-plugin-line);
  border-radius: var(--dibao-plugin-radius);
  background: var(--dibao-plugin-surface);
}

.dibao-plugin .panel,
.dibao-plugin .settings,
.dibao-plugin .empty {
  padding: var(--dibao-plugin-space-4);
}

.dibao-plugin .rule-list,
.dibao-plugin .delivery-list,
.dibao-plugin .conditions,
.dibao-plugin .content,
.dibao-plugin .topic-list,
.dibao-plugin .cluster-list,
.dibao-plugin .section-stack,
.dibao-plugin .secret-list {
  display: grid;
  gap: var(--dibao-plugin-space-2);
}

.dibao-plugin .rule-row,
.dibao-plugin .delivery-row {
  width: 100%;
  padding: var(--dibao-plugin-space-3);
  text-align: left;
}

.dibao-plugin .rule-row {
  cursor: pointer;
}

.dibao-plugin .grid,
.dibao-plugin .settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--dibao-plugin-space-3);
}

.dibao-plugin .settings-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.dibao-plugin label {
  display: grid;
  gap: 6px;
  color: var(--dibao-plugin-muted);
  font-size: 12px;
  font-weight: 750;
}

.dibao-plugin .span-2 {
  grid-column: 1 / -1;
}

.dibao-plugin input,
.dibao-plugin select,
.dibao-plugin textarea {
  width: 100%;
  border: 1px solid var(--dibao-plugin-line);
  border-radius: 6px;
  background: var(--dibao-plugin-surface);
  color: var(--dibao-plugin-ink);
  padding: 9px 10px;
}

.dibao-plugin input:not([type="checkbox"]),
.dibao-plugin select {
  min-height: 38px;
}

.dibao-plugin textarea {
  min-height: 96px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.45;
}

.dibao-plugin input[type="checkbox"] {
  width: 18px;
  height: 18px;
  min-height: 18px;
  flex: 0 0 auto;
  padding: 0;
}

.dibao-plugin .check,
.dibao-plugin .checkbox-label,
.dibao-plugin .topic-toggle,
.dibao-plugin .cluster-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--dibao-plugin-space-3);
}

.dibao-plugin .condition {
  display: grid;
  grid-template-columns: minmax(120px, 1.4fr) minmax(100px, 0.8fr) minmax(120px, 1fr) auto;
  gap: var(--dibao-plugin-space-2);
  align-items: center;
}

.dibao-plugin .section-stack {
  gap: var(--dibao-plugin-space-4);
}

.dibao-plugin .section-card {
  display: grid;
  gap: var(--dibao-plugin-space-3);
  border: 1px solid var(--dibao-plugin-line-soft);
  border-radius: var(--dibao-plugin-radius);
  background: var(--dibao-plugin-surface);
  padding: var(--dibao-plugin-space-4);
}

.dibao-plugin .section-head,
.dibao-plugin .subhead,
.dibao-plugin .list-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--dibao-plugin-space-3);
}

.dibao-plugin .section-head h3,
.dibao-plugin .subhead h3 {
  margin-bottom: 0;
}

.dibao-plugin .help {
  margin: 4px 0 0;
  color: var(--dibao-plugin-muted);
  font-size: 13px;
  line-height: 1.55;
  font-weight: 500;
}

.dibao-plugin .callout {
  border: 1px solid var(--dibao-plugin-line-soft);
  border-radius: 6px;
  background: var(--dibao-plugin-paper);
  padding: var(--dibao-plugin-space-3);
  color: var(--dibao-plugin-ink);
  font-size: 13px;
  line-height: 1.55;
}

.dibao-plugin .switch-line {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--dibao-plugin-space-2);
  min-height: 38px;
  color: var(--dibao-plugin-ink);
  white-space: nowrap;
}

.dibao-plugin .template-chip,
.dibao-plugin .variable-chip {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  border: 1px solid var(--dibao-plugin-line);
  border-radius: 999px;
  background: var(--dibao-plugin-paper);
  color: var(--dibao-plugin-pine);
  cursor: default;
  padding: 3px 9px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  font-weight: 750;
}

button.template-chip,
button.variable-chip {
  cursor: pointer;
}

.dibao-plugin .template-chip:hover,
.dibao-plugin .variable-chip:hover {
  border-color: var(--dibao-plugin-pine);
}

.dibao-plugin .table-scroll {
  width: 100%;
  overflow-x: auto;
}

.dibao-plugin .data-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  border: 1px solid var(--dibao-plugin-line-soft);
  border-radius: 6px;
  overflow: hidden;
  background: var(--dibao-plugin-surface);
  font-size: 13px;
}

.dibao-plugin .data-table th,
.dibao-plugin .data-table td {
  border-bottom: 1px solid var(--dibao-plugin-line-soft);
  padding: 9px;
  text-align: left;
  vertical-align: top;
}

.dibao-plugin .data-table th {
  background: var(--dibao-plugin-paper);
  color: var(--dibao-plugin-muted);
  font-size: 12px;
  font-weight: 800;
}

.dibao-plugin .data-table tr:last-child td {
  border-bottom: 0;
}

.dibao-plugin .data-table code {
  color: var(--dibao-plugin-pine);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

.dibao-plugin .details {
  border: 1px solid var(--dibao-plugin-line-soft);
  border-radius: var(--dibao-plugin-radius);
  background: var(--dibao-plugin-surface);
}

.dibao-plugin .details > summary {
  cursor: pointer;
  padding: var(--dibao-plugin-space-3) var(--dibao-plugin-space-4);
  color: var(--dibao-plugin-ink);
  font-size: 14px;
  font-weight: 800;
}

.dibao-plugin .details[open] > summary {
  border-bottom: 1px solid var(--dibao-plugin-line-soft);
  background: var(--dibao-plugin-paper);
}

.dibao-plugin .details > :not(summary) {
  margin-left: var(--dibao-plugin-space-4);
  margin-right: var(--dibao-plugin-space-4);
}

.dibao-plugin .details > :last-child {
  margin-bottom: var(--dibao-plugin-space-4);
}

.dibao-plugin .json-textarea {
  min-height: 160px;
}

.dibao-plugin .list-row {
  align-items: center;
  border: 1px solid var(--dibao-plugin-line-soft);
  border-radius: 6px;
  background: var(--dibao-plugin-paper);
  padding: var(--dibao-plugin-space-3);
}

.dibao-plugin .error {
  border: 1px solid var(--dibao-plugin-danger);
  border-radius: 6px;
  background: var(--dibao-plugin-danger-soft);
  color: var(--dibao-plugin-danger);
  padding: 10px 12px;
}

.dibao-plugin .pill {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--dibao-plugin-line);
  border-radius: 999px;
  background: var(--dibao-plugin-paper);
  color: var(--dibao-plugin-muted);
  padding: 2px 8px;
  font-size: 12px;
}

.dibao-plugin .topic-family,
.dibao-plugin .group {
  overflow: hidden;
}

.dibao-plugin .topic-head,
.dibao-plugin .group-head {
  border-bottom: 1px solid var(--dibao-plugin-line-soft);
  background: var(--dibao-plugin-paper);
}

.dibao-plugin .topic-head {
  padding: var(--dibao-plugin-space-3) var(--dibao-plugin-space-4);
}

.dibao-plugin .group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--dibao-plugin-space-3);
  padding: 14px var(--dibao-plugin-space-4);
}

.dibao-plugin .group-head h2 {
  margin: 0;
}

.dibao-plugin .cluster-list {
  padding: var(--dibao-plugin-space-2) var(--dibao-plugin-space-4) var(--dibao-plugin-space-3);
}

.dibao-plugin .cluster-toggle {
  min-height: 30px;
  color: var(--dibao-plugin-ink);
  font-size: 13px;
  font-weight: 650;
}

.dibao-plugin .count {
  color: var(--dibao-plugin-muted);
  font-size: 12px;
  font-weight: 750;
}

.dibao-plugin .article {
  display: grid;
  gap: 7px;
  border-top: 1px solid var(--dibao-plugin-line-soft);
  padding: 14px var(--dibao-plugin-space-4);
}

.dibao-plugin .article:first-of-type {
  border-top: 0;
}

.dibao-plugin .article button {
  border: 0;
  background: transparent;
  color: var(--dibao-plugin-ink);
  cursor: pointer;
  padding: 0;
  text-align: left;
  font-size: 16px;
  font-weight: 750;
}

.dibao-plugin .summary {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: #3d423d;
  font-size: 13px;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}

.dibao-plugin .empty {
  color: var(--dibao-plugin-muted);
  border-style: dashed;
}

@media (max-width: 820px) {
  .dibao-plugin .page {
    padding: var(--dibao-plugin-space-3);
  }

  body.dibao-plugin > .shell {
    padding: var(--dibao-plugin-space-3);
  }

  .dibao-plugin .toolbar,
  .dibao-plugin .header,
  .dibao-plugin .layout,
  .dibao-plugin .grid,
  .dibao-plugin .settings-grid,
  .dibao-plugin .condition {
    grid-template-columns: 1fr;
  }

  .dibao-plugin .toolbar,
  .dibao-plugin .header,
  .dibao-plugin .section-head,
  .dibao-plugin .subhead,
  .dibao-plugin .list-row {
    display: grid;
  }

  .dibao-plugin .switch-line {
    justify-content: flex-start;
  }

  .dibao-plugin .data-table {
    min-width: 640px;
  }
}
`;
