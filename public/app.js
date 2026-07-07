(function () {
  "use strict";

  const recordBtn = document.getElementById("recordBtn");
  const recordLabel = document.getElementById("recordLabel");
  const langSelect = document.getElementById("langSelect");
  const statusEl = document.getElementById("status");
  const transcriptEl = document.getElementById("transcript");
  const copyBtn = document.getElementById("copyBtn");
  const clearBtn = document.getElementById("clearBtn");
  const wordCountEl = document.getElementById("wordCount");
  const unsupportedEl = document.getElementById("unsupported");

  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  let recognition = null;
  let listening = false;
  let starting = false;
  let finalText = "";

  function setStatus(message, type) {
    statusEl.textContent = message;
    statusEl.className = "status" + (type ? " " + type : "");
  }

  function updateWordCount() {
    const text = transcriptEl.value.trim();
    const words = text ? text.split(/\s+/).length : 0;
    wordCountEl.textContent = words + (words === 1 ? " word" : " words");
  }

  function render(interim) {
    transcriptEl.value = finalText + (interim || "");
    updateWordCount();
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  if (!SpeechRecognition) {
    unsupportedEl.classList.remove("hidden");
    recordBtn.disabled = true;
    setStatus("Speech recognition not supported in this browser.", "error");
    return;
  }

  function createRecognition() {
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = langSelect.value;

    rec.onstart = function () {
      starting = false;
      listening = true;
      recordBtn.classList.add("listening");
      recordLabel.textContent = "Stop Listening";
      setStatus("Listening...", "active");
    };

    rec.onresult = function (event) {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const chunk = result[0].transcript;
        if (result.isFinal) {
          finalText += chunk.trim() + " ";
        } else {
          interim += chunk;
        }
      }
      render(interim);
    };

    rec.onerror = function (event) {
      // Recoverable: keep listening.
      if (event.error === "no-speech") {
        setStatus("No speech detected. Keep talking...", "active");
        return;
      }
      // User aborted (e.g. pressed Stop) — no message needed.
      if (event.error === "aborted") {
        return;
      }
      // Permission errors — terminal, needs user action.
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        starting = false;
        listening = false;
        setStatus(
          "Microphone access denied. Allow the mic and open this app in a new tab.",
          "error"
        );
        resetButton();
        return;
      }
      // All other errors (audio-capture, network, etc.) are terminal for this
      // session. Stop cleanly instead of looping restarts.
      starting = false;
      listening = false;
      setStatus("Error: " + event.error + ". Stopped.", "error");
      resetButton();
    };

    rec.onend = function () {
      starting = false;
      // Auto-restart only if the user is still in listening mode (recognition
      // stops on its own after silence in some browsers).
      if (listening) {
        try {
          starting = true;
          rec.start();
        } catch (e) {
          starting = false;
          listening = false;
          resetButton();
        }
      } else {
        resetButton();
      }
    };

    return rec;
  }

  function resetButton() {
    recordBtn.classList.remove("listening");
    recordLabel.textContent = "Start Listening";
    if (statusEl.classList.contains("active")) {
      setStatus("Stopped.");
    }
  }

  function startListening() {
    // Idempotent: ignore if already starting or active.
    if (starting || listening) return;
    starting = true;
    finalText = transcriptEl.value ? transcriptEl.value.trim() + " " : "";
    recognition = createRecognition();
    try {
      recognition.start();
    } catch (e) {
      starting = false;
      setStatus("Could not start: " + e.message, "error");
    }
  }

  function stopListening() {
    listening = false;
    starting = false;
    if (recognition) {
      recognition.stop();
    }
    resetButton();
  }

  recordBtn.addEventListener("click", function () {
    if (listening) {
      stopListening();
    } else {
      startListening();
    }
  });

  langSelect.addEventListener("change", function () {
    if (listening) {
      stopListening();
      setStatus("Language changed. Press Start to continue.");
    }
  });

  copyBtn.addEventListener("click", function () {
    if (!transcriptEl.value) {
      setStatus("Nothing to copy.");
      return;
    }
    navigator.clipboard
      .writeText(transcriptEl.value)
      .then(function () {
        setStatus("Copied to clipboard.");
      })
      .catch(function () {
        transcriptEl.select();
        document.execCommand("copy");
        setStatus("Copied to clipboard.");
      });
  });

  clearBtn.addEventListener("click", function () {
    finalText = "";
    transcriptEl.value = "";
    updateWordCount();
    setStatus("Cleared.");
  });

  transcriptEl.addEventListener("input", function () {
    finalText = transcriptEl.value;
    updateWordCount();
  });

  updateWordCount();
})();
