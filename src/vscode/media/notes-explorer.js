(() => {
  const vscode = acquireVsCodeApi();
  const tree = document.getElementById("tree");
  const menu = document.getElementById("menu");
  const saved = vscode.getState() || {};
  const expanded = new Set(saved.expanded || []);
  const nodes = new Map();
  const children = new Map();
  const loading = new Set();
  let roots = [];
  let labels = {};
  let selectedId = saved.selectedId;
  let revealIds = [];
  let revealSelect = false;

  function saveState() {
    vscode.setState({ expanded: [...expanded], selectedId });
  }

  function select(id, notify = true) {
    selectedId = id;
    saveState();
    render();
    if (notify) {
      vscode.postMessage({ type: "focus" });
      vscode.postMessage({ type: "select", id });
    }
  }

  function requestChildren(id) {
    if (children.has(id) || loading.has(id)) return;
    loading.add(id);
    vscode.postMessage({ type: "children", parentId: id });
  }

  function toggle(node) {
    if (!node.expandable) return;
    if (expanded.has(node.id)) {
      expanded.delete(node.id);
    } else {
      expanded.add(node.id);
      requestChildren(node.id);
    }
    saveState();
    render();
  }

  function visibleNodes() {
    const result = [];
    const visit = (items, depth) => {
      for (const node of items) {
        result.push({ node, depth });
        if (expanded.has(node.id)) {
          visit(children.get(node.id) || [], depth + 1);
        }
      }
    };
    visit(roots, 0);
    return result;
  }

  function render() {
    const fragment = document.createDocumentFragment();
    const visible = visibleNodes();
    if (visible.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = labels.empty || "No files to display";
      fragment.appendChild(empty);
    }
    for (const { node, depth } of visible) {
      const row = document.createElement("div");
      row.className = `row${selectedId === node.id ? " selected" : ""}${expanded.has(node.id) ? " expanded" : ""}`;
      row.dataset.id = node.id;
      row.style.paddingLeft = `${depth * 12 + 2}px`;
      row.tabIndex = selectedId === node.id ? 0 : -1;
      row.setAttribute("role", "treeitem");
      row.setAttribute("aria-level", String(depth + 1));
      row.setAttribute("aria-selected", String(selectedId === node.id));
      if (node.expandable) {
        row.setAttribute("aria-expanded", String(expanded.has(node.id)));
      }

      const twistie = document.createElement("button");
      twistie.className = `twistie${node.expandable ? "" : " hidden"}`;
      twistie.tabIndex = -1;
      twistie.setAttribute("aria-label", node.expandable ? node.label : "");
      twistie.addEventListener("click", (event) => {
        event.stopPropagation();
        select(node.id);
        toggle(node);
      });
      row.appendChild(twistie);

      const icon = document.createElement("span");
      icon.className = `item-icon ${node.kind}`;
      icon.setAttribute("aria-hidden", "true");
      row.appendChild(icon);

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = node.label;
      row.appendChild(name);

      if (node.note) {
        const note = document.createElement("span");
        note.className = `note style-${node.style || "default"}`;
        note.textContent = node.note;
        note.title = node.note;
        row.appendChild(note);
      } else if (node.status) {
        const status = document.createElement("span");
        status.className = "status";
        status.textContent = node.status;
        row.appendChild(status);
      }

      row.addEventListener("click", () => select(node.id));
      row.addEventListener("dblclick", () => {
        if (node.expandable) toggle(node);
        else if (node.kind === "missing") {
          vscode.postMessage({ type: "action", action: "relink", id: node.id });
        }
        else vscode.postMessage({ type: "action", action: "open", id: node.id });
      });
      row.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        select(node.id);
        showMenu(node, event.clientX, event.clientY);
      });
      fragment.appendChild(row);
    }
    tree.replaceChildren(fragment);
    driveReveal();
  }

  function menuAction(action, label) {
    return { action, label };
  }

  function actionsFor(node) {
    if (node.kind === "missing") {
      return [
        menuAction("relink", labels.relink),
        "separator",
        menuAction("clearNote", labels.clearNote),
      ];
    }
    if (node.kind === "missing-group") return [];
    const result = [
      menuAction("open", labels.open),
      ...(node.kind === "file" ? [menuAction("openSide", labels.openSide)] : []),
    ];
    if (node.kind === "root" || node.kind === "folder") {
      result.push(
        "separator",
        menuAction("newFile", labels.newFile),
        menuAction("newFolder", labels.newFolder),
      );
    }
    if (node.kind !== "root") {
      result.push(
        "separator",
        menuAction("rename", labels.rename),
        menuAction("delete", labels.delete),
      );
    }
    result.push(
      "separator",
      menuAction("copyPath", labels.copyPath),
      menuAction("copyRelativePath", labels.copyRelativePath),
      menuAction("revealExplorer", labels.revealExplorer),
      menuAction("revealOs", labels.revealOs),
    );
    if (!node.contextValue.endsWith("unavailable") && !node.contextValue.endsWith("config")) {
      result.push("separator", menuAction("editNote", labels.editNote));
      if (node.note) {
        result.push(
          menuAction("setStyle", labels.setStyle),
          menuAction("clearNote", labels.clearNote),
        );
      }
    }
    return result;
  }

  function showMenu(node, x, y) {
    const actions = actionsFor(node);
    if (actions.length === 0) return;
    const fragment = document.createDocumentFragment();
    for (const item of actions) {
      if (item === "separator") {
        const separator = document.createElement("div");
        separator.className = "menu-separator";
        separator.setAttribute("role", "separator");
        fragment.appendChild(separator);
        continue;
      }
      const button = document.createElement("button");
      button.className = "menu-item";
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.textContent = item.label;
      button.addEventListener("click", () => {
        hideMenu();
        vscode.postMessage({ type: "action", action: item.action, id: node.id });
      });
      fragment.appendChild(button);
    }
    menu.replaceChildren(fragment);
    menu.hidden = false;
    const width = 200;
    const height = Math.min(menu.scrollHeight, window.innerHeight - 8);
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - height - 4))}px`;
    menu.querySelector("button")?.focus();
  }

  function hideMenu() {
    menu.hidden = true;
    menu.replaceChildren();
  }

  function moveSelection(delta) {
    const visible = visibleNodes().map(({ node }) => node);
    if (visible.length === 0) return;
    const current = visible.findIndex((node) => node.id === selectedId);
    const next = visible[Math.max(0, Math.min(visible.length - 1, current + delta))] || visible[0];
    select(next.id);
    requestAnimationFrame(() => {
      tree.querySelector(`[data-id="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: "nearest" });
      tree.querySelector(`[data-id="${CSS.escape(next.id)}"]`)?.focus();
    });
  }

  function driveReveal() {
    if (revealIds.length === 0) return;
    for (let index = 0; index < revealIds.length - 1; index += 1) {
      const id = revealIds[index];
      expanded.add(id);
      if (!children.has(id)) {
        requestChildren(id);
        saveState();
        return;
      }
    }
    const target = revealIds[revealIds.length - 1];
    if (nodes.has(target)) {
      if (revealSelect) {
        selectedId = target;
        vscode.postMessage({ type: "select", id: target });
      }
      revealIds = [];
      saveState();
      requestAnimationFrame(() => {
        const row = tree.querySelector(`[data-id="${CSS.escape(target)}"]`);
        row?.scrollIntoView({ block: "nearest" });
      });
    }
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "reset") {
      roots = message.roots || [];
      labels = message.labels || labels;
      nodes.clear();
      children.clear();
      loading.clear();
      roots.forEach((node) => {
        nodes.set(node.id, node);
        expanded.add(node.id);
        requestChildren(node.id);
      });
      render();
    } else if (message.type === "children") {
      loading.delete(message.parentId);
      const list = message.nodes || [];
      children.set(message.parentId, list);
      list.forEach((node) => nodes.set(node.id, node));
      for (const node of list) {
        if (expanded.has(node.id)) requestChildren(node.id);
      }
      render();
    } else if (message.type === "reveal") {
      revealIds = message.ids || [];
      revealSelect = message.select === true;
      revealIds.slice(0, -1).forEach((id) => expanded.add(id));
      saveState();
      driveReveal();
      render();
    }
  });

  window.addEventListener("focus", () => {
    document.body.classList.add("focused");
    vscode.postMessage({ type: "focus" });
  });
  window.addEventListener("blur", () => {
    document.body.classList.remove("focused");
    vscode.postMessage({ type: "blur" });
  });
  window.addEventListener("pointerdown", (event) => {
    if (!menu.contains(event.target)) hideMenu();
  });
  window.addEventListener("keydown", (event) => {
    if (!menu.hidden) {
      if (event.key === "Escape") {
        event.preventDefault();
        hideMenu();
      }
      return;
    }
    const node = nodes.get(selectedId);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
    } else if (event.key === "ArrowRight" && node?.expandable) {
      event.preventDefault();
      if (!expanded.has(node.id)) toggle(node);
    } else if (event.key === "ArrowLeft" && node?.expandable && expanded.has(node.id)) {
      event.preventDefault();
      toggle(node);
    } else if (event.key === "Enter" && node) {
      event.preventDefault();
      if (node.expandable) toggle(node);
      else if (node.kind === "missing") {
        vscode.postMessage({ type: "action", action: "relink", id: node.id });
      }
      else vscode.postMessage({ type: "action", action: "open", id: node.id });
    } else if (event.key === "F2" && node && (node.kind === "file" || node.kind === "folder")) {
      event.preventDefault();
      vscode.postMessage({ type: "action", action: "rename", id: node.id });
    } else if ((event.key === "Delete" || event.key === "Backspace") && node?.kind === "missing") {
      event.preventDefault();
      vscode.postMessage({ type: "action", action: "clearNote", id: node.id });
    } else if ((event.key === "Delete" || event.key === "Backspace") && node && (node.kind === "file" || node.kind === "folder")) {
      event.preventDefault();
      vscode.postMessage({ type: "action", action: "delete", id: node.id });
    }
  });

  vscode.postMessage({ type: "ready" });
})();
