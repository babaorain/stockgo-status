(function () {
  "use strict";

  const data = window.STOCKGO_STATUS;
  if (!data) {
    document.getElementById("headline").textContent = "狀態資料尚未產生";
    document.getElementById("summary").textContent = "請先執行 stockgo.py dashboard 產生靜態狀態檔。";
    return;
  }

  const labels = {
    current: "正常", building: "建置中", collecting: "收集中", validated: "已驗證",
    complete: "已完成", in_progress: "進行中", waiting: "等待中", delayed: "延遲",
    missing: "缺少", success: "成功", failed: "失敗", running: "執行中", not_run: "尚未執行"
  };
  const fmt = new Intl.NumberFormat("zh-TW");
  const text = (value, fallback = "—") => value === null || value === undefined || value === "" ? fallback : String(value);
  const esc = value => text(value).replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
  const statusLabel = status => labels[status] || text(status);
  const badge = status => `<span class="badge ${status}">${esc(statusLabel(status))}</span>`;
  const line = (status, value) => `<span class="status-line"><span class="dot ${status}"></span>${esc(value)}</span>`;
  const time = value => value ? new Date(value).toLocaleString("zh-TW", { hour12: false, timeZone: "Asia/Taipei" }) : "—";

  document.getElementById("headline").textContent = data.headline;
  document.getElementById("summary").textContent = data.summary;
  document.getElementById("updated-at").textContent = `最後更新：${time(data.generated_at)}`;
  document.getElementById("public-policy").textContent = data.safety.public_data_policy;

  document.getElementById("stage-summary").innerHTML = data.stages.map((stage, index) => `
    <li class="${stage.status}">
      <div class="stage-title"><span class="stage-index">${index + 1}</span><span>${esc(stage.name)} ${badge(stage.status)}</span></div>
      <small>${esc(stage.description)}</small>
    </li>`).join("");

  const formal = data.formal;
  const p2 = data.p2;
  const pm = p2.metrics;
  const blockerText = rows => esc(rows.length ? rows.join("；") : "目前沒有阻塞項目");
  document.getElementById("database-comparison").innerHTML = `
    <tr><th>用途</th><td>${esc(formal.role)}</td><td>${esc(p2.role)}</td></tr>
    <tr><th>最新行情</th><td>${line(formal.status, text(formal.latest_market_date))}</td><td>${line(p2.status, text(p2.latest_market_date))}</td></tr>
    <tr><th>關鍵內容</th><td>${fmt.format(formal.datasets.find(x => x.key === "features")?.rows || 0)} 筆 Features；${fmt.format(formal.datasets.find(x => x.key === "labels")?.rows || 0)} 筆 v2 Labels</td><td>${fmt.format(pm.paper_total)} 筆 Paper（目前版本 ${fmt.format(pm.paper_current_protocol)}）；研究 ${fmt.format(pm.trial_results)} / ${fmt.format(pm.trial_plans)} 完成</td></tr>
    <tr><th>目前狀態</th><td>${badge(formal.status)} ${blockerText(formal.blockers)}</td><td>${badge(p2.status)} ${blockerText(p2.blockers)}</td></tr>
    <tr><th>使用原則</th><td>研究、報告與完整性檢查以正式庫為主。</td><td>不可回填成正式庫；只做前瞻證據與驗證。</td></tr>`;

  document.getElementById("freshness-list").innerHTML = formal.datasets.map(row => `
    <div class="freshness-row ${row.status}">
      <strong>${esc(row.label)}</strong>
      <time>${esc(text(row.date))}</time>
      <span>${line(row.status, statusLabel(row.status))}</span>
      <span class="note">${esc(row.note)} · ${fmt.format(row.rows)} 筆</span>
    </div>`).join("");

  document.getElementById("validation-path").innerHTML = data.stages.map((stage, index) => `
    <li class="${stage.status}">
      <span class="stage-index">${stage.status === "complete" ? "✓" : index + 1}</span>
      <strong>${esc(stage.name)} · ${esc(statusLabel(stage.status))}</strong>
      <p>${esc(stage.description)}</p>
    </li>`).join("");

  const metrics = [
    ["Paper（目前 / 全部）", `${fmt.format(pm.paper_current_protocol)} / ${fmt.format(pm.paper_total)}`],
    ["Paper 已結算", pm.paper_settled],
    ["研究（完成 / 登記）", `${fmt.format(pm.trial_results)} / ${fmt.format(pm.trial_plans)}`],
    ["模擬對帳", pm.broker_reconciliations]
  ];
  document.getElementById("evidence-metrics").innerHTML = metrics.map(([name, value]) => `
    <div class="metric"><span>${esc(name)}</span><strong>${esc(typeof value === "number" ? fmt.format(value) : value)}</strong></div>`).join("");

  document.getElementById("operation-list").innerHTML = data.operations.map(op => `
    <tr title="${esc(op.purpose)}">
      <td><strong>${esc(op.name)}</strong><br><small>${esc(op.purpose)}</small></td>
      <td>${esc(op.schedule)}</td>
      <td>${line(op.status, statusLabel(op.status))}</td>
      <td>${time(op.finished_at)}</td>
    </tr>`).join("");

  document.getElementById("next-actions").innerHTML = data.actions.length
    ? data.actions.map(action => `<li><div><strong>${esc(action.title)}</strong><p>${esc(action.detail)}</p></div></li>`).join("")
    : "<li><div><strong>維持每日監控</strong><p>目前沒有新增阻塞項目，繼續累積前瞻證據。</p></div></li>";

  document.getElementById("reload").addEventListener("click", () => window.location.reload());
  const links = Array.from(document.querySelectorAll("nav a"));
  links.forEach(link => link.addEventListener("click", () => {
    links.forEach(item => item.classList.remove("active"));
    link.classList.add("active");
  }));
})();
