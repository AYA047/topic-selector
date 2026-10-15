const $ = (id) => document.getElementById(id);

const state = {
  topics: [],
  presenters: [],
  stage: "topic", // topic -> presenter -> done
  topic: null,
  spinning: false,
};

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function currentItems() {
  return state.stage === "topic" ? state.topics : state.presenters;
}

async function load() {
  try {
    [state.topics, state.presenters] = await Promise.all([
      api("/api/topics"),
      api("/api/presenters"),
    ]);
    render();
  } catch (error) {
    $("resultNote").textContent = `Couldn't load the lists: ${error.message}`;
  }
}

function renderList(listElement, items, kind, countElement) {
  countElement.textContent = kind === "topics"
    ? `${items.length} ${items.length === 1 ? "topic" : "topics"}`
    : `${items.length} ${items.length === 1 ? "person" : "people"}`;
  listElement.replaceChildren();

  if (!items.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = kind === "topics" ? "No topics yet — add one above." : "No presenters yet — add someone above.";
    listElement.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = item.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-btn";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${item.name}`);
    remove.addEventListener("click", async () => {
      if (state.spinning) return;
      try {
        await api(`/api/${kind}/${item.id}`, { method: "DELETE" });
        await load();
      } catch (error) {
        $(kind === "topics" ? "topicErr" : "presErr").textContent = error.message;
      }
    });
    li.append(name, remove);
    listElement.appendChild(li);
  });
}

function render() {
  renderList($("topicList"), state.topics, "topics", $("topicCount"));
  renderList($("presList"), state.presenters, "presenters", $("presCount"));

  const done = state.stage === "done";
  const isTopic = state.stage === "topic";
  $("stageTitle").textContent = isTopic ? "First, pick a topic" : done ? "The round is complete" : "Now, pick a presenter";
  if ($("stageDescription")) {
    $("stageDescription").textContent = isTopic
      ? "The chosen topic will disappear from the topic list."
      : done ? "Topic chosen, presenter chosen. Ready for another round?"
      : `Who's going to present “${state.topic?.name ?? "the topic"}”?`;
  }
  $("pickerKicker").textContent = isTopic ? "The topic is..." : done ? "All picked!" : "Presenting today...";
  $("spinBtn").textContent = isTopic ? "Choose a topic" : "Choose a presenter";
  $("spinBtn").classList.toggle("hidden", done);
  $("nextRoundBtn").classList.toggle("hidden", !done);
  $("spinBtn").disabled = state.spinning;

  if (!state.spinning && !done && !$("rollingName").classList.contains("is-winner")) {
    $("rollingName").textContent = currentItems().length ? "Ready when you are" : (isTopic ? "Add a topic to begin" : "Add a presenter first");
    $("pickerHint").textContent = currentItems().length ? "Names will roll until one is chosen." : "Your list is empty for now.";
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rollNames(items, winner) {
  const nameElement = $("rollingName");
  nameElement.classList.remove("is-winner");
  nameElement.classList.add("is-rolling");
  $("pickerHint").textContent = "And the name is...";
  const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 350 : 2300;
  const interval = 75;
  const start = performance.now();
  let index = Math.floor(Math.random() * items.length);
  while (performance.now() - start < duration) {
    nameElement.textContent = items[index % items.length].name;
    index += 1;
    await wait(interval);
  }
  nameElement.classList.remove("is-rolling");
  nameElement.textContent = winner.name;
  void nameElement.offsetWidth;
  nameElement.classList.add("is-winner");
}

async function showWinnerReveal(winner, isTopic) {
  const overlay = $("winnerOverlay");
  const name = $("winnerName");
  const label = $("winnerLabel");
  name.textContent = winner.name;
  label.textContent = isTopic ? "The chosen topic" : "Today's presenter";
  overlay.classList.remove("is-fading", "is-visible");
  void overlay.offsetWidth;
  overlay.classList.add("is-visible");
  await wait(2600); // keep the winner readable before fading away
  overlay.classList.add("is-fading");
  await wait(760);
  overlay.classList.remove("is-visible", "is-fading");
  name.textContent = "";
}

async function spin() {
  if (state.spinning || state.stage === "done") return;
  const isTopic = state.stage === "topic";
  const items = [...currentItems()];
  if (!items.length) {
    $("resultNote").textContent = isTopic ? "Add at least one topic first." : "Add at least one presenter first.";
    return;
  }

  state.spinning = true;
  $("topicErr").textContent = "";
  $("presErr").textContent = "";
  $("resultNote").textContent = "";
  $("spinBtn").disabled = true;
  $("rollingName").classList.remove("is-winner");
  $("rollingName").textContent = "Let's see...";
  $("pickerHint").textContent = "Picking at random...";
  render();

  try {
    const winner = await api(isTopic ? "/api/topics/spin" : "/api/presenters/spin", {
      method: "POST",
      body: JSON.stringify({ remove: !isTopic && $("removePres").checked }),
    });
    await rollNames(items, winner);
    await showWinnerReveal(winner, isTopic);

    if (isTopic) {
      state.topic = winner;
      state.stage = "presenter";
      $("resultNote").innerHTML = `${escapeHTML(winner.name)}<small>Topic selected and removed from the list.</small>`;
      $("recap").classList.add("hidden");
    } else {
      state.stage = "done";
      $("resultNote").innerHTML = `${escapeHTML(winner.name)}<small>will present “${escapeHTML(state.topic.name)}”.</small>`;
      $("recapTopic").textContent = state.topic.name;
      $("recapPresenter").textContent = winner.name;
      $("recap").classList.remove("hidden");
    }
    await load();
  } catch (error) {
    $("resultNote").textContent = "";
    $(isTopic ? "topicErr" : "presErr").textContent = error.message;
    $("rollingName").textContent = "Let's try again";
    $("pickerHint").textContent = "Check your list and try again.";
  } finally {
    state.spinning = false;
    render();
  }
}

function addForm(formId, inputId, kind, errorId) {
  $(formId).addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.spinning) return;
    const input = $(inputId);
    $(errorId).textContent = "";
    const name = input.value.trim();
    if (!name) {
      $(errorId).textContent = "Please enter a name first.";
      input.focus();
      return;
    }
    try {
      await api(`/api/${kind}`, { method: "POST", body: JSON.stringify({ name }) });
      input.value = "";
      await load();
      input.focus();
    } catch (error) {
      $(errorId).textContent = error.message;
    }
  });
}

addForm("topicForm", "topicInput", "topics", "topicErr");
addForm("presForm", "presInput", "presenters", "presErr");

function openModal(modalId, inputId) {
  if (state.spinning) return;
  $(modalId).classList.remove("hidden");
  $(inputId).focus();
}
function closeModal(modalId) { $(modalId).classList.add("hidden"); }

$("openTopics").addEventListener("click", () => openModal("topicsModal", "topicInput"));
$("openPresenters").addEventListener("click", () => openModal("presentersModal", "presInput"));
document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => closeModal(button.dataset.close));
});
["topicsModal", "presentersModal"].forEach((id) => {
  $(id).addEventListener("click", (event) => { if (event.target.id === id) closeModal(id); });
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { closeModal("topicsModal"); closeModal("presentersModal"); }
});

$("spinBtn").addEventListener("click", spin);
$("nextRoundBtn").addEventListener("click", () => {
  if (state.spinning) return;
  state.stage = "topic";
  state.topic = null;
  $("resultNote").textContent = "";
  $("recap").classList.add("hidden");
  $("rollingName").classList.remove("is-winner", "is-rolling");
  $("rollingName").textContent = "Ready when you are";
  $("pickerHint").textContent = "Names will roll until one is chosen.";
  render();
});

window.addEventListener("load", () => {
  window.setTimeout(() => $("introScreen")?.classList.add("is-leaving"), 3400);
  window.setTimeout(() => $("introScreen")?.remove(), 4100);
});

load();
