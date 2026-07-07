(function () {
  "use strict";

  const CATEGORIES = [
    { name: "Searching for equipment", icon: "🔍" },
    { name: "Missing linen / pillowcases", icon: "🛏️" },
    { name: "Lack of available clinical space", icon: "🚪" },
    { name: "Slow computer systems", icon: "💻" },
    { name: "Delays locating staff", icon: "👥" },
    { name: "Waiting for porters", icon: "🛒" },
    { name: "Difficulty obtaining supplies", icon: "📦" },
    { name: "Administrative hand-offs", icon: "📋" },
    { name: "Other", icon: "➕" },
  ];

  // --- Element refs ---
  const categoryGrid = document.getElementById("categoryGrid");
  const descriptionEl = document.getElementById("description");
  const locationEl = document.getElementById("location");
  const reporterEl = document.getElementById("reporter");
  const priorityGroup = document.getElementById("priorityGroup");
  const submitBtn = document.getElementById("submitBtn");
  const formMsg = document.getElementById("formMsg");
  const voiceBtn = document.getElementById("voiceBtn");
  const voiceLabel = document.getElementById("voiceLabel");
  const voiceStatus = document.getElementById("voiceStatus");
  const unsupportedEl = document.getElementById("unsupported");
  const reportListEl = document.getElementById("reportList");
  const statusFilter = document.getElementById("statusFilter");
  const refreshBtn = document.getElementById("refreshBtn");
  const tabs = document.querySelectorAll(".tab");
  const reportView = document.getElementById("reportView");
  const listView = document.getElementById("listView");

  let selectedCategory = null;
  let selectedPriority = "Medium";

  // --- Build category chips ---
  CATEGORIES.forEach(function (cat) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "category-chip";
    btn.dataset.category = cat.name;
    btn.innerHTML =
      '<span class="chip-icon" aria-hidden="true">' + cat.icon + "</span>" +
      "<span>" + cat.name + "</span>";
    btn.addEventListener("click", function () {
      selectedCategory = cat.name;
      document.querySelectorAll(".category-chip").forEach(function (c) {
        c.classList.toggle("active", c.dataset.category === cat.name);
      });
      if (formMsg.classList.contains("error")) setFormMsg("", "");
    });
    categoryGrid.appendChild(btn);
  });

  // --- Priority selection ---
  priorityGroup.addEventListener("click", function (e) {
    const btn = e.target.closest(".priority-btn");
    if (!btn) return;
    selectedPriority = btn.dataset.priority;
    priorityGroup.querySelectorAll(".priority-btn").forEach(function (b) {
      b.classList.toggle("active", b === btn);
    });
  });

  function setFormMsg(text, type) {
    formMsg.textContent = text;
    formMsg.className = "form-msg" + (type ? " " + type : "");
  }

  // --- Tab switching ---
  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      tabs.forEach(function (t) { t.classList.remove("active"); });
      tab.classList.add("active");
      const view = tab.dataset.view;
      reportView.classList.toggle("hidden", view !== "report");
      listView.classList.toggle("hidden", view !== "list");
      if (view === "list") loadReports();
    });
  });

  // --- Submit report ---
  submitBtn.addEventListener("click", function () {
    const description = descriptionEl.value.trim();
    if (!selectedCategory) {
      setFormMsg("Please pick an issue type above.", "error");
      return;
    }
    if (!description) {
      setFormMsg("Please describe the issue (speak or type).", "error");
      descriptionEl.focus();
      return;
    }

    submitBtn.disabled = true;
    setFormMsg("Sending...", "");

    fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: selectedCategory,
        description: description,
        location: locationEl.value.trim(),
        reporter: reporterEl.value.trim(),
        priority: selectedPriority,
      }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (r) {
        if (!r.ok) {
          throw new Error(r.data.error || "Could not save report.");
        }
        setFormMsg("Report submitted. Thank you!", "ok");
        resetForm();
      })
      .catch(function (err) {
        setFormMsg(err.message, "error");
      })
      .finally(function () {
        submitBtn.disabled = false;
      });
  });

  function resetForm() {
    descriptionEl.value = "";
    locationEl.value = "";
    reporterEl.value = "";
    selectedCategory = null;
    document.querySelectorAll(".category-chip").forEach(function (c) {
      c.classList.remove("active");
    });
    selectedPriority = "Medium";
    priorityGroup.querySelectorAll(".priority-btn").forEach(function (b) {
      b.classList.toggle("active", b.dataset.priority === "Medium");
    });
  }

  // --- Load & render reports ---
  function loadReports() {
    reportListEl.innerHTML = '<p class="empty">Loading...</p>';
    const status = statusFilter.value;
    const url = "/api/reports" + (status ? "?status=" + encodeURIComponent(status) : "");
    fetch(url)
      .then(function (res) { return res.json(); })
      .then(function (reports) {
        renderReports(reports);
      })
      .catch(function () {
        reportListEl.innerHTML =
          '<p class="empty">Could not load reports. Try refreshing.</p>';
      });
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatTime(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  }

  function renderReports(reports) {
    if (!reports || reports.length === 0) {
      reportListEl.innerHTML = '<p class="empty">No reports yet.</p>';
      return;
    }
    reportListEl.innerHTML = "";
    reports.forEach(function (r) {
      const item = document.createElement("div");
      item.className = "report-item p-" + r.priority;

      const meta = [];
      if (r.location) meta.push("<strong>" + escapeHtml(r.location) + "</strong>");
      if (r.reporter) meta.push("by " + escapeHtml(r.reporter));
      meta.push(formatTime(r.created_at));
      meta.push(escapeHtml(r.priority) + " priority");

      const statusClass = r.status === "In progress" ? "In-progress" : r.status;

      item.innerHTML =
        '<div class="report-top">' +
          '<span class="report-cat">' + escapeHtml(r.category) + "</span>" +
          '<span class="badge ' + statusClass + '">' + escapeHtml(r.status) + "</span>" +
        "</div>" +
        '<p class="report-desc">' + escapeHtml(r.description) + "</p>" +
        '<div class="report-meta">' + meta.join(" • ") + "</div>";

      const select = document.createElement("select");
      select.className = "status-select";
      ["Open", "In progress", "Resolved"].forEach(function (s) {
        const opt = document.createElement("option");
        opt.value = s;
        opt.textContent = "Mark: " + s;
        if (s === r.status) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener("change", function () {
        updateStatus(r.id, select.value, item);
      });
      item.appendChild(select);

      reportListEl.appendChild(item);
    });
  }

  function updateStatus(id, status, item) {
    fetch("/api/reports/" + id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: status }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(function (r) {
        const badge = item.querySelector(".badge");
        const statusClass = r.status === "In progress" ? "In-progress" : r.status;
        badge.className = "badge " + statusClass;
        badge.textContent = r.status;
      })
      .catch(function () {
        // Reload on failure to resync UI.
        loadReports();
      });
  }

  statusFilter.addEventListener("change", loadReports);
  refreshBtn.addEventListener("click", loadReports);

  // ============ Voice input (Web Speech API) ============
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  let recognition = null;
  let listening = false;
  let starting = false;
  let baseText = "";

  function setVoiceStatus(msg, type) {
    voiceStatus.textContent = msg;
    voiceStatus.className = "voice-status" + (type ? " " + type : "");
  }

  if (!SpeechRecognition) {
    voiceBtn.disabled = true;
    voiceLabel.textContent = "Voice N/A";
    unsupportedEl.classList.remove("hidden");
    setVoiceStatus("Voice input isn't supported here — please type your report.", "");
  } else {
    voiceBtn.addEventListener("click", function () {
      if (listening) stopVoice();
      else startVoice();
    });
  }

  function resetVoiceButton() {
    voiceBtn.classList.remove("listening");
    voiceLabel.textContent = "Speak";
  }

  function createRecognition() {
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-GB";

    rec.onstart = function () {
      starting = false;
      listening = true;
      voiceBtn.classList.add("listening");
      voiceLabel.textContent = "Stop";
      setVoiceStatus("Listening... speak now.", "active");
    };
    rec.onaudiostart = function () {
      setVoiceStatus("Microphone active — speak now.", "active");
    };
    rec.onspeechstart = function () {
      setVoiceStatus("Hearing you...", "active");
    };

    rec.onresult = function (event) {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          baseText += result[0].transcript.trim() + " ";
        } else {
          interim += result[0].transcript;
        }
      }
      descriptionEl.value = (baseText + interim).replace(/\s+/g, " ").trimStart();
    };

    rec.onerror = function (event) {
      if (event.error === "no-speech") {
        setVoiceStatus("Didn't catch that — keep talking.", "active");
        return;
      }
      if (event.error === "aborted") return;

      starting = false;
      listening = false;
      resetVoiceButton();

      if (event.error === "not-allowed") {
        setVoiceStatus(
          "Microphone blocked. Click the mic/lock icon in the address bar and allow it.",
          "error"
        );
      } else if (event.error === "service-not-allowed") {
        setVoiceStatus(
          "On Windows, turn ON Settings > Privacy > Speech > 'Online speech recognition'.",
          "error"
        );
      } else if (event.error === "audio-capture") {
        setVoiceStatus("No microphone found. Check your input device.", "error");
      } else if (event.error === "network") {
        setVoiceStatus("Network error — voice needs an internet connection.", "error");
      } else {
        setVoiceStatus("Voice error: " + event.error + ". You can type instead.", "error");
      }
    };

    rec.onend = function () {
      starting = false;
      if (listening) {
        try {
          starting = true;
          rec.start();
        } catch (e) {
          starting = false;
          listening = false;
          resetVoiceButton();
        }
      } else {
        resetVoiceButton();
      }
    };

    return rec;
  }

  function startVoice() {
    if (starting || listening) return;
    starting = true;
    baseText = descriptionEl.value ? descriptionEl.value.trim() + " " : "";
    recognition = createRecognition();
    try {
      recognition.start();
    } catch (e) {
      starting = false;
      setVoiceStatus("Could not start voice: " + e.message, "error");
    }
  }

  function stopVoice() {
    listening = false;
    starting = false;
    if (recognition) recognition.stop();
    resetVoiceButton();
    setVoiceStatus("Stopped. Review your text, then submit.", "");
  }
})();
