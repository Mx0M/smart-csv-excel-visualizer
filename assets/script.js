// --- State ---
let rows = []; // array of objects
let cols = []; // column names
let chart; // Chart.js instance

// --- Utilities ---
const $ = (id) => document.getElementById(id);
const isNumber = (v) => v !== null && v !== "" && !isNaN(+v);
const looksLikeDate = (v) => {
  if (!v) return false;
  const d = new Date(v);
  return !isNaN(d.getTime());
};

function inferTypes(sampleRows, headers) {
  const info = headers.map((h) => ({
    name: h,
    numeric: 0,
    date: 0,
    empty: 0,
    total: 0,
  }));
  const take = Math.min(sampleRows.length, 1000);
  for (let i = 0; i < take; i++) {
    const r = sampleRows[i];
    headers.forEach((h, j) => {
      const v = r[h];
      info[j].total++;
      if (v === undefined || v === null || v === "") info[j].empty++;
      else if (isNumber(v)) info[j].numeric++;
      else if (looksLikeDate(v)) info[j].date++;
    });
  }
  return info.map((c) => ({
    name: c.name,
    kind:
      c.date > 0.6 * c.total
        ? "date"
        : c.numeric > 0.6 * c.total
        ? "number"
        : "string",
  }));
}

function groupBy(arr, key) {
  const map = new Map();
  for (const r of arr) {
    const k = r[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

function aggregate(arr, col, fn) {
  if (fn === "count") return arr.length;
  const vals = arr.map((r) => +r[col]).filter((x) => !isNaN(x));
  if (vals.length === 0) return null;
  if (fn === "sum") return vals.reduce((a, b) => a + b, 0);
  if (fn === "avg") return vals.reduce((a, b) => a + b, 0) / vals.length;
  if (fn === "median") {
    vals.sort((a, b) => a - b);
    const mid = Math.floor(vals.length / 2);
    return vals.length % 2 !== 0 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  }
  return null;
}

function makeSuggestions(meta) {
  const suggestions = [];
  const dates = meta.filter((c) => c.kind === "date").map((c) => c.name);
  const nums = meta.filter((c) => c.kind === "number").map((c) => c.name);
  const cats = meta.filter((c) => c.kind === "string").map((c) => c.name);

  if (dates.length && nums.length) {
    suggestions.push({
      label: `Line: ${nums[0]} over ${dates[0]}`,
      type: "line",
      x: dates[0],
      y: [nums[0]],
      agg: "none",
    });
  }
  if (cats.length && nums.length) {
    suggestions.push({
      label: `Bar: ${nums[0]} by ${cats[0]}`,
      type: "bar",
      x: cats[0],
      y: [nums[0]],
      agg: "avg",
    });
  }
  if (nums.length >= 2) {
    suggestions.push({
      label: `Scatter: ${nums[0]} vs ${nums[1]}`,
      type: "scatter",
      x: nums[0],
      y: [nums[1]],
      agg: "none",
    });
  }
  if (cats.length && nums.length) {
    suggestions.push({
      label: `Pie: ${nums[0]} by ${cats[0]}`,
      type: "pie",
      x: cats[0],
      y: [nums[0]],
      agg: "sum",
    });
  }
  return suggestions;
}

function updateSelectors(meta) {
  const xSel = $("xCol");
  const ySel = $("yCol");
  xSel.innerHTML = "";
  ySel.innerHTML = "";
  meta.forEach((c) => {
    const o1 = document.createElement("option");
    o1.value = o1.textContent = c.name;
    xSel.appendChild(o1);
    const o2 = document.createElement("option");
    o2.value = o2.textContent = c.name;
    ySel.appendChild(o2);
  });
}

function renderSuggestions(list) {
  const box = $("suggestions");
  box.innerHTML = "";
  list.forEach((s) => {
    const b = document.createElement("button");
    b.textContent = s.label;
    b.className = "ghost";
    b.onclick = () => {
      $("chartType").value = s.type;
      $("xCol").value = s.x;
      [...$("yCol").options].forEach(
        (o) => (o.selected = s.y.includes(o.value))
      );
      $("agg").value = s.agg;
      drawChart();
    };
    box.appendChild(b);
  });
}

function drawChart() {
  if (!rows.length || !cols.length) return;
  const meta = inferTypes(rows, cols);
  const typeSel = $("chartType").value;
  const x = $("xCol").value || meta[0].name;
  const ys = [...$("yCol").selectedOptions].map((o) => o.value);
  const agg = $("agg").value;

  const type =
    typeSel === "auto" ? (looksLikeDate(rows[0][x]) ? "line" : "bar") : typeSel;

  let labels = [];
  let datasets = [];

  if (type === "pie") {
    const by = groupBy(rows, x);
    const y = ys[0];
    labels = [...by.keys()];
    const data = labels.map(
      (k) => aggregate(by.get(k), y, agg === "none" ? "sum" : agg) || 0
    );
    datasets = [{ label: y, data }];
  } else if (agg === "none" || type === "scatter") {
    // raw rows
    if (type === "scatter" && ys[0]) {
      datasets = [
        {
          label: `${ys[0]} vs ${x}`,
          data: rows
            .filter((r) => isNumber(r[x]) && isNumber(r[ys[0]]))
            .map((r) => ({ x: +r[x], y: +r[ys[0]] })),
        },
      ];
    } else {
      labels = rows.map((r) => r[x]);
      datasets = ys.map((y) => ({
        label: y,
        data: rows.map((r) => (isNumber(r[y]) ? +r[y] : null)),
      }));
    }
  } else {
    // aggregated by x
    const by = groupBy(rows, x);
    labels = [...by.keys()];
    datasets = ys.map((y) => ({
      label: y,
      data: labels.map((k) => aggregate(by.get(k), y, agg) || 0),
    }));
  }

  const ctx = $("chart").getContext("2d");
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type:
      type === "scatter"
        ? "scatter"
        : type === "line"
        ? "line"
        : type === "bar"
        ? "bar"
        : "pie",
    data: { labels, datasets },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { position: "bottom" }, title: { display: false } },
      scales:
        type === "pie"
          ? {}
          : { x: { ticks: { maxRotation: 45, minRotation: 0 } } },
    },
  });

  updateEmbed();
}

function updateEmbed() {
  // Simple iframe embed snippet for this page + current hash state
  const url = location.href;
  $(
    "embedCode"
  ).value = `<iframe src="${url}" style="width:100%;min-height:460px;border:0;border-radius:16px"></iframe>`;
}

async function parseFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt")) {
    return new Promise((resolve) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
        complete: (res) => resolve(res.data),
      });
    });
  }
  // Excel via SheetJS
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

async function parseCSVText(text) {
  return new Promise((resolve) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (res) => resolve(res.data),
    });
  });
}

function setData(data) {
  rows = data;
  cols = rows.length ? Object.keys(rows[0]) : [];
  $("rowCount").textContent = `rows: ${rows.length}`;
  $("colCount").textContent = `cols: ${cols.length}`;
  $("status").textContent = rows.length ? "Loaded ✓" : "No rows found";
  const meta = inferTypes(rows, cols);
  updateSelectors(meta);
  renderSuggestions(makeSuggestions(meta));
  // pick first suggestion if any
  const firstBtn = $("suggestions").querySelector("button");
  if (firstBtn) firstBtn.click();
  saveToHash();
}

function saveToHash() {
  // Compress small datasets into hash for shareable links (limit ~150KB)
  try {
    const payload = JSON.stringify({
      rows,
      settings: {
        type: $("chartType").value,
        x: $("xCol").value,
        y: [...$("yCol").selectedOptions].map((o) => o.value),
        agg: $("agg").value,
      },
    });
    const comp = LZString.compressToEncodedURIComponent(payload);
    if (comp.length < 150000) {
      location.hash = comp;
    } else {
      location.hash = "";
      console.warn("Dataset too large for hash share");
    }
    updateEmbed();
  } catch (e) {
    console.warn(e);
  }
}

function restoreFromHash() {
  if (!location.hash) return;
  try {
    const payload = JSON.parse(
      LZString.decompressFromEncodedURIComponent(location.hash.slice(1)) || "{}"
    );
    if (payload.rows && Array.isArray(payload.rows)) {
      setData(payload.rows);
      if (payload.settings) {
        $("chartType").value = payload.settings.type || "auto";
        $("xCol").value = payload.settings.x || $("xCol").value;
        [...$("yCol").options].forEach(
          (o) => (o.selected = (payload.settings.y || []).includes(o.value))
        );
        $("agg").value = payload.settings.agg || "none";
        drawChart();
      }
    }
  } catch (e) {
    console.warn("Failed to restore from hash", e);
  }
}

// --- Events ---
$("file").addEventListener("change", async (e) => {
  if (!e.target.files?.length) return;
  $("status").textContent = "Parsing…";
  const data = await parseFile(e.target.files[0]);
  setData(data);
});

$("drop").addEventListener("dragover", (e) => {
  e.preventDefault();
  $("drop").classList.add("drag");
});
$("drop").addEventListener("dragleave", () =>
  $("drop").classList.remove("drag")
);
$("drop").addEventListener("drop", async (e) => {
  e.preventDefault();
  $("drop").classList.remove("drag");
  const file = e.dataTransfer.files?.[0];
  if (!file) return;
  $("status").textContent = "Parsing…";
  const data = await parseFile(file);
  setData(data);
});

$("fetchBtn").addEventListener("click", async () => {
  const url = $("url").value.trim();
  if (!url) return alert("Enter a CSV or XLSX URL");
  $("status").textContent = "Fetching…";
  try {
    const res = await fetch(url);
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/vnd") || url.match(/\.xlsx?$/)) {
      const buf = await res.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      setData(XLSX.utils.sheet_to_json(ws, { defval: "" }));
    } else {
      const text = await res.text();
      setData(await parseCSVText(text));
    }
  } catch (err) {
    console.error(err);
    alert("Failed to fetch or parse file. Check CORS.");
    $("status").textContent = "Fetch failed";
  }
});

$("sampleBtn").addEventListener("click", () => {
  const csv = `date,product,region,sales\n2025-01-01,A,North,120\n2025-01-02,A,South,90\n2025-01-03,B,North,150\n2025-01-04,B,South,80\n2025-01-05,A,West,130\n2025-01-06,C,North,60\n2025-01-07,C,West,95\n2025-01-08,B,South,110`;
  Papa.parse(csv, { header: true, complete: (r) => setData(r.data) });
});

$("renderBtn").addEventListener("click", () => {
  drawChart();
  saveToHash();
});
$("chartType").addEventListener("change", () => {
  drawChart();
  saveToHash();
});
$("xCol").addEventListener("change", () => {
  drawChart();
  saveToHash();
});
$("yCol").addEventListener("change", () => {
  drawChart();
  saveToHash();
});
$("agg").addEventListener("change", () => {
  drawChart();
  saveToHash();
});

$("downloadPNG").addEventListener("click", () => {
  if (!chart) return;
  const a = document.createElement("a");
  a.href = $("chart").toDataURL("image/png");
  a.download = "chart.png";
  a.click();
});

$("shareBtn").addEventListener("click", () => {
  saveToHash();
  navigator.clipboard.writeText(location.href);
  alert("Link copied to clipboard!");
});

window.addEventListener("hashchange", restoreFromHash);

// boot
restoreFromHash();
