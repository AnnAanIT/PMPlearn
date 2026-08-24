(function () {
  "use strict";

  var STORAGE_KEY = "pmp-vocab-progress-v1";

  // ---------- Progress persistence ----------
  function loadProgress() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }
  function saveProgress(progress) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch (e) {
      /* localStorage unavailable — ignore */
    }
  }

  var progress = loadProgress(); // { [id]: true } means "known"

  function isKnown(id) {
    return !!progress[id];
  }
  function setKnown(id, value) {
    if (value) progress[id] = true;
    else delete progress[id];
    saveProgress(progress);
  }

  // ---------- State ----------
  var state = {
    activeModule: "all", // "all" or module id number
    tab: "flashcard",
    flashFilter: "all", // all | known | unknown
    flashOrder: [], // array of vocab ids in current order
    flashIndex: 0,
    flashFlipped: false,
    search: "",
    statusFilter: "all",
  };

  var vocabById = {};
  VOCAB.forEach(function (v) {
    vocabById[v.id] = v;
  });

  function moduleName(id) {
    var m = MODULES.filter(function (mm) { return mm.id === id; })[0];
    return m ? m.name : "";
  }

  function vocabByModule(moduleId) {
    if (moduleId === "all") return VOCAB;
    return VOCAB.filter(function (v) { return v.m === moduleId; });
  }

  // ---------- Sidebar ----------
  function renderSidebar() {
    var list = document.getElementById("moduleList");
    list.innerHTML = "";

    MODULES.forEach(function (m) {
      var terms = vocabByModule(m.id);
      var knownCount = terms.filter(function (v) { return isKnown(v.id); }).length;
      var pct = terms.length ? Math.round((knownCount / terms.length) * 100) : 0;

      var wrap = document.createElement("div");

      var btn = document.createElement("button");
      btn.className = "module-item" + (state.activeModule === m.id ? " active" : "");
      btn.dataset.module = m.id;
      btn.innerHTML =
        '<span class="module-name">' + m.id + ". " + escapeHtml(m.name) + "</span>" +
        '<span class="module-count">' + knownCount + "/" + terms.length + "</span>";
      btn.addEventListener("click", function () {
        state.activeModule = m.id;
        onModuleOrFilterChange();
      });

      var track = document.createElement("div");
      track.className = "module-progress-track";
      var fill = document.createElement("div");
      fill.className = "module-progress-fill";
      fill.style.width = pct + "%";
      track.appendChild(fill);

      wrap.appendChild(btn);
      wrap.appendChild(track);
      list.appendChild(wrap);
    });

    var allBtn = document.querySelector('.all-item');
    allBtn.classList.toggle("active", state.activeModule === "all");
    document.getElementById("countAll").textContent =
      VOCAB.filter(function (v) { return isKnown(v.id); }).length + "/" + VOCAB.length;
  }

  function renderGlobalStats() {
    var total = VOCAB.length;
    var known = VOCAB.filter(function (v) { return isKnown(v.id); }).length;
    var pct = total ? Math.round((known / total) * 100) : 0;
    document.getElementById("globalStats").innerHTML =
      "<span>Tổng: <b>" + total + "</b> từ</span>" +
      "<span>Đã thuộc: <b>" + known + "</b></span>" +
      "<span>Tiến độ: <b>" + pct + "%</b></span>";
  }

  // ---------- Flashcard view ----------
  function currentFlashPool() {
    var terms = vocabByModule(state.activeModule);
    if (state.flashFilter === "known") terms = terms.filter(function (v) { return isKnown(v.id); });
    if (state.flashFilter === "unknown") terms = terms.filter(function (v) { return !isKnown(v.id); });
    return terms;
  }

  function rebuildFlashOrder(preserveShuffle) {
    var pool = currentFlashPool();
    var ids = pool.map(function (v) { return v.id; });
    if (preserveShuffle) shuffle(ids);
    state.flashOrder = ids;
    state.flashIndex = 0;
    state.flashFlipped = false;
    renderFlashcard();
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  function renderFlashcard() {
    var card = document.getElementById("flashCard");
    var empty = document.getElementById("flashEmpty");
    var total = state.flashOrder.length;

    document.getElementById("flashPosition").textContent =
      (total ? state.flashIndex + 1 : 0) + " / " + total;
    document.getElementById("flashProgressFill").style.width =
      (total ? ((state.flashIndex + 1) / total) * 100 : 0) + "%";

    if (!total) {
      card.hidden = true;
      document.querySelector(".flash-actions").hidden = true;
      empty.hidden = false;
      document.getElementById("flashModuleTag").textContent = "";
      return;
    }
    card.hidden = false;
    document.querySelector(".flash-actions").hidden = false;
    empty.hidden = true;

    var id = state.flashOrder[state.flashIndex];
    var v = vocabById[id];

    document.getElementById("flashModuleTag").textContent = v.m + ". " + moduleName(v.m);
    document.getElementById("flashTerm").textContent = v.term;
    document.getElementById("flashVi").textContent = v.vi;

    card.classList.toggle("flipped", state.flashFlipped);
  }

  function flipCard() {
    state.flashFlipped = !state.flashFlipped;
    document.getElementById("flashCard").classList.toggle("flipped", state.flashFlipped);
  }

  function goNext() {
    if (!state.flashOrder.length) return;
    state.flashIndex = (state.flashIndex + 1) % state.flashOrder.length;
    state.flashFlipped = false;
    renderFlashcard();
  }
  function goPrev() {
    if (!state.flashOrder.length) return;
    state.flashIndex = (state.flashIndex - 1 + state.flashOrder.length) % state.flashOrder.length;
    state.flashFlipped = false;
    renderFlashcard();
  }

  function markCurrent(known) {
    if (!state.flashOrder.length) return;
    var id = state.flashOrder[state.flashIndex];
    setKnown(id, known);
    renderSidebar();
    renderGlobalStats();

    // If current filter excludes the new status, remove it from the pool.
    if (
      (state.flashFilter === "unknown" && known) ||
      (state.flashFilter === "known" && !known)
    ) {
      state.flashOrder.splice(state.flashIndex, 1);
      if (state.flashIndex >= state.flashOrder.length) state.flashIndex = 0;
      state.flashFlipped = false;
      renderFlashcard();
    } else {
      goNext();
    }
    // keep list view in sync if visible
    renderList();
  }

  // ---------- List view ----------
  function renderList() {
    var terms = vocabByModule(state.activeModule);

    if (state.statusFilter === "known") terms = terms.filter(function (v) { return isKnown(v.id); });
    if (state.statusFilter === "unknown") terms = terms.filter(function (v) { return !isKnown(v.id); });

    var q = state.search.trim().toLowerCase();
    if (q) {
      terms = terms.filter(function (v) {
        return v.term.toLowerCase().indexOf(q) !== -1 || v.vi.toLowerCase().indexOf(q) !== -1;
      });
    }

    document.getElementById("listCount").textContent = terms.length + " thuật ngữ";

    var container = document.getElementById("vocabList");
    container.innerHTML = "";

    if (!terms.length) {
      var p = document.createElement("p");
      p.className = "flash-empty";
      p.textContent = "Không tìm thấy thuật ngữ phù hợp.";
      container.appendChild(p);
      return;
    }

    var frag = document.createDocumentFragment();
    terms.forEach(function (v) {
      var known = isKnown(v.id);
      var item = document.createElement("div");
      item.className = "vocab-item " + (known ? "is-known" : "is-unknown");

      var main = document.createElement("div");
      main.className = "vocab-main";
      main.innerHTML =
        '<div class="vocab-term-row">' +
          '<span class="vocab-term">' + escapeHtml(v.term) + "</span>" +
          '<span class="vocab-module-tag">' + v.m + ". " + escapeHtml(moduleName(v.m)) + "</span>" +
        "</div>" +
        '<p class="vocab-vi">' + escapeHtml(v.vi) + "</p>";

      var toggle = document.createElement("button");
      toggle.className = "vocab-toggle" + (known ? " checked" : "");
      toggle.title = known ? "Đánh dấu chưa thuộc" : "Đánh dấu đã thuộc";
      toggle.textContent = known ? "✓" : "";
      toggle.addEventListener("click", function () {
        setKnown(v.id, !known);
        renderSidebar();
        renderGlobalStats();
        renderList();
      });

      item.appendChild(main);
      item.appendChild(toggle);
      frag.appendChild(item);
    });
    container.appendChild(frag);
  }

  // ---------- Shared ----------
  function onModuleOrFilterChange() {
    renderSidebar();
    rebuildFlashOrder(false);
    renderList();
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ---------- Wiring ----------
  function initTabs() {
    var buttons = document.querySelectorAll(".tab-btn");
    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        buttons.forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        state.tab = btn.dataset.tab;
        document.querySelectorAll(".view").forEach(function (v) { v.classList.remove("active"); });
        document.getElementById(state.tab + "View").classList.add("active");
      });
    });
  }

  function initFlashcard() {
    document.getElementById("flashCard").addEventListener("click", flipCard);
    document.getElementById("nextBtn").addEventListener("click", goNext);
    document.getElementById("prevBtn").addEventListener("click", goPrev);
    document.getElementById("markKnownBtn").addEventListener("click", function () { markCurrent(true); });
    document.getElementById("markUnknownBtn").addEventListener("click", function () { markCurrent(false); });
    document.getElementById("shuffleBtn").addEventListener("click", function () { rebuildFlashOrder(true); });

    document.querySelectorAll('input[name="flashFilter"]').forEach(function (radio) {
      radio.addEventListener("change", function () {
        state.flashFilter = radio.value;
        rebuildFlashOrder(false);
      });
    });

    document.addEventListener("keydown", function (e) {
      if (state.tab !== "flashcard") return;
      // Don't hijack keys while the user is interacting with a form control
      // (e.g. Space/Arrow on a focused button or the flashFilter radios).
      var tag = (e.target && e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "select" || tag === "textarea" || tag === "button") return;

      if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === " " || e.key === "Enter") { e.preventDefault(); flipCard(); }
    });
  }

  function initList() {
    document.getElementById("searchInput").addEventListener("input", function (e) {
      state.search = e.target.value;
      renderList();
    });
    document.getElementById("statusFilter").addEventListener("change", function (e) {
      state.statusFilter = e.target.value;
      renderList();
    });
  }

  function init() {
    initTabs();
    initFlashcard();
    initList();
    document.querySelector(".all-item").addEventListener("click", function () {
      state.activeModule = "all";
      onModuleOrFilterChange();
    });

    renderSidebar();
    renderGlobalStats();
    rebuildFlashOrder(false);
    renderList();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
