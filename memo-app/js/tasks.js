// ── Google Tasks ──
let currentTaskListId = "@default";

async function initTasksCard() {
  const status = document.getElementById("tasksStatus");
  status.textContent = "할 일 목록 불러오는 중...";
  try {
    const res = await apiFetch("/api/tasks/lists");
    if (res.status === 403) {
      status.textContent = "⚠ Tasks 권한이 없습니다. 로그아웃 후 다시 로그인하세요.";
      return;
    }
    if (!res.ok) {
      status.textContent = `불러오기 실패 (오류 ${res.status})`;
      return;
    }
    const { items } = await res.json();
    if (!items?.length) { status.textContent = "할 일 목록이 없습니다"; return; }

    const sel = document.getElementById("taskListSel");
    sel.innerHTML = items.map(l =>
      `<option value="${l.id}">${l.title}</option>`
    ).join("");
    currentTaskListId = items[0].id;
    status.textContent = "";
    setTaskDueToday();
    fetchTasks(currentTaskListId);
  } catch (e) {
    status.textContent = "할 일을 불러올 수 없습니다: " + e.message;
  }
}

function setTaskDueToday() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  document.getElementById("taskNewDue").value = `${yyyy}-${mm}-${dd}`;
}

function onTaskListChange() {
  currentTaskListId = document.getElementById("taskListSel").value;
  fetchTasks(currentTaskListId);
}

async function fetchTasks(listId) {
  const status = document.getElementById("tasksStatus");
  document.getElementById("tasksList").innerHTML = "";
  status.textContent = "불러오는 중...";
  try {
    const res = await apiFetch(`/api/tasks/${listId}`);
    const { items } = await res.json();
    status.textContent = "";
    renderTasks(items || []);
  } catch {
    status.textContent = "할 일을 불러올 수 없습니다";
  }
}

function renderTasks(tasks) {
  const list = document.getElementById("tasksList");
  const todo = tasks.filter(t => t.status !== "completed");
  const done = tasks.filter(t => t.status === "completed");
  const sorted = [...todo, ...done];

  if (!sorted.length) {
    list.innerHTML = `<p class="tasks-empty">할 일이 없습니다 🎉</p>`;
    return;
  }
  list.innerHTML = sorted.map(t => {
    const isDone = t.status === "completed";
    const due = t.due ? new Date(t.due).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" }) : "";
    const overdue = t.due && !isDone && new Date(t.due) < new Date();
    return `
    <div class="task-item ${isDone ? "task-done" : ""}">
      <button class="task-check ${isDone ? "checked" : ""}" onclick="toggleTask('${t.id}', ${isDone})" title="${isDone ? "완료 취소" : "완료"}">
        ${isDone ? "✓" : ""}
      </button>
      <div class="task-info">
        <span class="task-title">${t.title || "(제목 없음)"}</span>
        ${due ? `<span class="task-due ${overdue ? "overdue" : ""}">${overdue ? "⚠ " : ""}${due}</span>` : ""}
      </div>
      <button class="task-delete-btn" onclick="deleteTask('${t.id}')" title="삭제">×</button>
    </div>`;
  }).join("");
}

async function addTask() {
  const titleEl = document.getElementById("taskNewTitle");
  const dueEl = document.getElementById("taskNewDue");
  const title = titleEl.value.trim();
  if (!title) return titleEl.focus();

  const addBtn = document.querySelector(".tasks-add-btn");
  addBtn.disabled = true;
  addBtn.textContent = "추가 중...";

  const body = { title };
  if (dueEl.value) body.due = dueEl.value + "T00:00:00.000Z";

  try {
    const res = await apiFetch(`/api/tasks/${currentTaskListId}/tasks`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      Swal.fire({ icon: "error", title: "추가 실패", text: err.error?.message || `오류 코드 ${res.status}` });
      return;
    }
    titleEl.value = "";
    setTaskDueToday();
    fetchTasks(currentTaskListId);
  } catch (e) {
    Swal.fire({ icon: "error", title: "오류", text: "할 일 추가 중 오류가 발생했습니다." });
  } finally {
    addBtn.disabled = false;
    addBtn.textContent = "추가";
  }
}

async function toggleTask(taskId, isDone) {
  const newStatus = isDone ? "needsAction" : "completed";
  try {
    await apiFetch(`/api/tasks/${currentTaskListId}/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: newStatus, ...(newStatus === "needsAction" ? { completed: null } : {}) }),
    });
    fetchTasks(currentTaskListId);
  } catch {
    Swal.fire({ icon: "error", title: "오류", text: "상태 변경 중 오류가 발생했습니다." });
  }
}

async function deleteTask(taskId) {
  const result = await Swal.fire({
    title: "이 할 일을 삭제할까요?",
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#e53935",
    cancelButtonColor: "#aaa",
    confirmButtonText: "삭제",
    cancelButtonText: "취소",
  });
  if (!result.isConfirmed) return;
  try {
    await apiFetch(`/api/tasks/${currentTaskListId}/tasks/${taskId}`, { method: "DELETE" });
    fetchTasks(currentTaskListId);
  } catch {
    Swal.fire({ icon: "error", title: "오류", text: "삭제 중 오류가 발생했습니다." });
  }
}
