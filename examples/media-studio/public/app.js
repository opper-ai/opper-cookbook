// Media Studio — SPA.
// Increment 1: bootstrap auth, render the studio shell (login gate vs studio).
// Generation, advanced options, references, gallery and the intent bar are
// wired in later increments.

const $ = (sel) => document.querySelector(sel);

const state = {
  me: null,
  sessionCost: 0,
};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  showLoginError();
  try {
    const res = await fetch("/api/me");
    state.me = await res.json();
  } catch {
    state.me = { authMode: "env", loggedIn: false, user: null };
  }

  if (!state.me.loggedIn) {
    // Only OAuth mode can be "logged out"; env mode is always logged in.
    $("#gate").hidden = false;
    $("#studio").hidden = true;
    return;
  }

  $("#gate").hidden = true;
  $("#studio").hidden = false;
  renderUserChip();
}

function renderUserChip() {
  const chip = $("#user-chip");
  const name = state.me?.user?.name ?? "";
  chip.textContent = name;
  if (state.me?.authMode === "oauth") {
    chip.style.cursor = "pointer";
    chip.title = "Log out";
    chip.onclick = async () => {
      await fetch("/api/logout", { method: "POST" });
      location.reload();
    };
  }
}

function showLoginError() {
  const params = new URLSearchParams(location.search);
  const err = params.get("login_error");
  if (!err) return;
  const el = $("#gate-error");
  el.textContent = err;
  el.hidden = false;
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

let toastTimer = null;
function toast(message, isError = false) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 4000);
}

window.studio = { state, toast }; // handy for debugging

boot();
