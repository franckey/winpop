const searchInput = document.getElementById("search");
const resultsList = document.getElementById("results-list");

let allProjects = [];
let filteredProjects = [];
let selectedIndex = 0;

const TYPE_ICONS = {
  node: "JS",
  rust: "Rs",
  python: "Py",
  go: "Go",
  dotnet: ".N",
  java: "Jv",
  project: "< >",
};

// Fuzzy match: returns { match: boolean, score: number, indices: number[] }
function fuzzyMatch(query, text) {
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();

  // Exact substring match gets highest score
  const substringIndex = textLower.indexOf(queryLower);
  if (substringIndex !== -1) {
    const indices = [];
    for (let i = substringIndex; i < substringIndex + query.length; i++) {
      indices.push(i);
    }
    return { match: true, score: 100 + (substringIndex === 0 ? 50 : 0), indices };
  }

  // Fuzzy character-by-character match
  let qi = 0;
  let score = 0;
  const indices = [];
  let prevMatchIndex = -2;

  for (let ti = 0; ti < textLower.length && qi < queryLower.length; ti++) {
    if (textLower[ti] === queryLower[qi]) {
      indices.push(ti);
      // Consecutive matches score higher
      if (ti === prevMatchIndex + 1) {
        score += 10;
      }
      // Start of word bonus
      if (ti === 0 || text[ti - 1] === "-" || text[ti - 1] === "_" || text[ti - 1] === " ") {
        score += 15;
      }
      prevMatchIndex = ti;
      qi++;
    }
  }

  if (qi === queryLower.length) {
    return { match: true, score, indices };
  }
  return { match: false, score: 0, indices: [] };
}

function highlightText(text, indices) {
  if (!indices.length) return escapeHtml(text);

  const indexSet = new Set(indices);
  let result = "";
  let inHighlight = false;

  for (let i = 0; i < text.length; i++) {
    if (indexSet.has(i)) {
      if (!inHighlight) {
        result += '<span class="highlight">';
        inHighlight = true;
      }
    } else {
      if (inHighlight) {
        result += "</span>";
        inHighlight = false;
      }
    }
    result += escapeHtml(text[i]);
  }
  if (inHighlight) result += "</span>";
  return result;
}

function escapeHtml(str) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
  return str.replace(/[&<>"']/g, (c) => map[c]);
}

function shortenPath(fullPath) {
  const home = fullPath.match(/^[A-Z]:\\Users\\[^\\]+/i);
  if (home) {
    return fullPath.replace(home[0], "~");
  }
  return fullPath;
}

function renderResults() {
  if (filteredProjects.length === 0) {
    const query = searchInput.value.trim();
    resultsList.innerHTML = `
      <div class="empty-state">
        <div class="icon">${query ? "🔍" : "📂"}</div>
        <p>${query ? "Aucun projet trouvé" : "Commencez à taper pour rechercher..."}</p>
      </div>`;
    return;
  }

  // Clamp selected index
  selectedIndex = Math.max(0, Math.min(selectedIndex, filteredProjects.length - 1));

  resultsList.innerHTML = filteredProjects
    .map(
      (project, i) => `
    <div class="result-item ${i === selectedIndex ? "selected" : ""}"
         data-index="${i}" data-path="${escapeHtml(project.path)}">
      <div class="project-icon ${project.type}">
        ${TYPE_ICONS[project.type] || "< >"}
      </div>
      <div class="project-info">
        <div class="project-name">${project.highlightedName || escapeHtml(project.name)}</div>
        <div class="project-path">${escapeHtml(shortenPath(project.path))}</div>
      </div>
      <div class="project-type-badge">${project.type}</div>
    </div>`
    )
    .join("");

  // Scroll selected into view
  const selected = resultsList.querySelector(".selected");
  if (selected) {
    selected.scrollIntoView({ block: "nearest" });
  }
}

function filterProjects(query) {
  if (!query.trim()) {
    filteredProjects = allProjects.map((p) => ({ ...p, highlightedName: null }));
  } else {
    filteredProjects = allProjects
      .map((project) => {
        const result = fuzzyMatch(query, project.name);
        if (!result.match) return null;
        return {
          ...project,
          score: result.score,
          highlightedName: highlightText(project.name, result.indices),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
  }

  selectedIndex = 0;
  renderResults();
}

// Event listeners
searchInput.addEventListener("input", () => {
  filterProjects(searchInput.value);
});

document.addEventListener("keydown", async (e) => {
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      if (filteredProjects.length > 0) {
        selectedIndex = (selectedIndex + 1) % filteredProjects.length;
        renderResults();
      }
      break;

    case "ArrowUp":
      e.preventDefault();
      if (filteredProjects.length > 0) {
        selectedIndex =
          selectedIndex <= 0 ? filteredProjects.length - 1 : selectedIndex - 1;
        renderResults();
      }
      break;

    case "Enter":
      e.preventDefault();
      if (filteredProjects[selectedIndex]) {
        await window.api.openProject(filteredProjects[selectedIndex].path);
      }
      break;

    case "Escape":
      e.preventDefault();
      await window.api.hideWindow();
      break;

    case "e":
      if (e.ctrlKey && filteredProjects[selectedIndex]) {
        e.preventDefault();
        await window.api.openInExplorer(filteredProjects[selectedIndex].path);
      }
      break;

    case "r":
      if (e.ctrlKey) {
        e.preventDefault();
        allProjects = await window.api.refreshProjects();
        filterProjects(searchInput.value);
      }
      break;
  }
});

resultsList.addEventListener("click", async (e) => {
  const item = e.target.closest(".result-item");
  if (item) {
    const index = parseInt(item.dataset.index, 10);
    selectedIndex = index;
    renderResults();
    await window.api.openProject(filteredProjects[index].path);
  }
});

resultsList.addEventListener("mousemove", (e) => {
  const item = e.target.closest(".result-item");
  if (item) {
    const index = parseInt(item.dataset.index, 10);
    if (index !== selectedIndex) {
      selectedIndex = index;
      renderResults();
    }
  }
});

// Window events
window.api.onWindowShown(() => {
  searchInput.value = "";
  searchInput.focus();
  filterProjects("");
});

// Live update when background scan completes
window.api.onProjectsUpdated((updatedProjects) => {
  allProjects = updatedProjects;
  filterProjects(searchInput.value);
});

// Initial load
(async () => {
  const config = await window.api.getConfig();
  const hintEl = document.getElementById("shortcut-hint");
  if (hintEl && config.shortcut) {
    hintEl.innerHTML = config.shortcut
      .split("+")
      .map((k) => `<kbd>${k.trim()}</kbd>`)
      .join("+");
  }

  allProjects = await window.api.getProjects();
  filterProjects("");
})();
