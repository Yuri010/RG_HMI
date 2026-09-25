const pallets = Array.from({ length: 16 }, (_, index) => ({
  id: index + 1,
  product: '010260248',
  processed: false,
  location: 'rack',
  rackSlot: index + 1
}));

const MAX_QUEUE_LENGTH = 3;
let controllerQueue = [];
let selectedPalletId = 1;
let robotBusy = false;
let queueSubmitting = false;
let machineOccupied = false;
let handEmpty = true;
let ioState = null;
const clockBusy = false;

const tableBody = document.getElementById('palletTableBody');
const robotStatusText = document.getElementById('robotStatusText');
const statusMessage = document.getElementById('statusMessage');
const machineSummary = document.getElementById('machineSummary');
const clockSummary = document.getElementById('clockSummary');
const handSummary = document.getElementById('handSummary');
const selectedSummary = document.getElementById('selectedSummary');
const themeToggle = document.getElementById('themeToggle');
const queueList = document.getElementById('queueList');
const queueEmptyState = document.getElementById('queueEmptyState');
const queueCount = document.getElementById('queueCount');

const moveToMachineBtn = document.getElementById('moveToMachineBtn');
const moveToRackBtn = document.getElementById('moveToRackBtn');
const refreshQueueBtn = document.getElementById('refreshQueueBtn');

const KCL_COMSET_URL = '/karel/ComSet';
const IO_STATE_URL = '/MD/IOSTATE.DG';
const NUMERIC_REGISTERS_URL = '/MD/NUMREG.VA';

const getSelectedPallet = () => pallets.find((pallet) => pallet.id === selectedPalletId);

function formatLocation(location) {
  switch (location) {
    case 'rack':
      return 'Rack';
    case 'machine':
      return 'Machine';
    case 'clock':
      return 'Clock station';
    case 'unknown':
      return 'Not detected';
    default:
      return 'Unknown';
  }
}

function firstFreeRackSlot() {
  const occupiedSlots = new Set(
    pallets.filter((pallet) => pallet.location === 'rack' && pallet.rackSlot !== null).map((pallet) => pallet.rackSlot)
  );

  for (let slot = 1; slot <= 16; slot += 1) {
    if (!occupiedSlots.has(slot)) return slot;
  }

  return null;
}

function formatQueueAction(action) {
  return action === 'machine' ? 'machine transfer' : 'rack return';
}

function getTaskProgramSet(action) {
  return action === 'machine' ? [1] : [2];
}

function renderQueue() {
  queueCount.textContent = `${controllerQueue.length} / ${MAX_QUEUE_LENGTH}`;

  if (controllerQueue.length === 0) {
    queueEmptyState.hidden = false;
    queueList.innerHTML = '';
    return;
  }

  queueEmptyState.hidden = true;
  queueList.innerHTML = controllerQueue
    .map((task, index) => `
      <div class="queue-item ${task.action}">
        <div class="queue-main">
          <span class="queue-order">${index + 1}</span>
          <div>
            <strong>Pallet ${task.palletId}</strong>
            <small>${formatQueueAction(task.action)}</small>
          </div>
        </div>
      </div>
    `)
    .join('');
}

function renderTable() {
  tableBody.innerHTML = pallets
    .map((pallet) => {
      const isSelected = pallet.id === selectedPalletId;
      const locationClass = pallet.location === 'rack'
        ? 'rack'
        : pallet.location === 'machine'
          ? 'machine'
          : pallet.location === 'clock'
            ? 'clock'
            : 'unknown';
      const statusClass = pallet.processed ? 'processed' : 'unprocessed';
      const statusText = pallet.processed ? 'Bewerkt' : 'Niet bewerkt';
      const locationLabel = pallet.location === 'rack' ? `Rack ${pallet.rackSlot}` : formatLocation(pallet.location);

      return `
        <tr class="${isSelected ? 'selected' : ''}" data-id="${pallet.id}">
          <td>${pallet.product}</td>
          <td><span class="badge ${statusClass}">${statusText}</span></td>
          <td><span class="badge ${locationClass}">${locationLabel}</span></td>
          <td>${pallet.id}</td>
        </tr>
      `;
    })
    .join('');

  tableBody.querySelectorAll('tr').forEach((row) => {
    row.addEventListener('click', () => {
      selectedPalletId = Number(row.dataset.id);
      render();
    });
  });
}

function updateSummaryCards() {
  const selected = getSelectedPallet();
  const currentMachinePallet = pallets.find((pallet) => pallet.location === 'machine');

  machineSummary.textContent = currentMachinePallet ? `Pallet ${currentMachinePallet.id}` : 'Empty';
  clockSummary.textContent = clockBusy ? 'Occupied' : 'Available';
  handSummary.textContent = handEmpty ? 'Empty' : 'Occupied';
  selectedSummary.textContent = selected ? `Pallet ${selected.id} · ${formatLocation(selected.location)}` : 'No pallet';

  if (!selected) {
    moveToMachineBtn.disabled = true;
    moveToRackBtn.disabled = true;
    return;
  }

  const queueFull = controllerQueue.length >= MAX_QUEUE_LENGTH;
  const palletInRack = selected.location === 'rack';
  const palletInMachine = selected.location === 'machine';
  const selectedAlreadyProcessed = selected.processed;

  moveToMachineBtn.disabled = !(
    !robotBusy &&
    !queueSubmitting &&
    !queueFull &&
    !selectedAlreadyProcessed &&
    palletInRack &&
    !machineOccupied &&
    handEmpty
  );

  moveToRackBtn.disabled = !(
    !robotBusy &&
    !queueSubmitting &&
    !queueFull &&
    palletInMachine &&
    handEmpty
  );

  refreshQueueBtn.disabled = false;
}

function setRobotStatus(text, message) {
  robotStatusText.textContent = text;
  statusMessage.textContent = message;
}

function parseIoState(responseText) {
  const state = { flags: {}, userOutputs: {} };
  const booleanValue = '(ON|OFF|TRUE|FALSE|1|0)';
  for (const match of responseText.matchAll(new RegExp(`\\b(?:F|FLG)\\s*\\[?\\s*(\\d+)\\s*\\]?\\s*=?\\s*${booleanValue}\\b`, 'gi'))) {
    state.flags[Number(match[1])] = /ON|TRUE|1/i.test(match[2]);
  }
  for (const match of responseText.matchAll(new RegExp(`\\bUO\\s*\\[?\\s*(\\d+)\\s*\\]?\\s*=?\\s*${booleanValue}\\b`, 'gi'))) {
    state.userOutputs[Number(match[1])] = /ON|TRUE|1/i.test(match[2]);
  }
  return state;
}

function applyIoState(state) {
  ioState = state;
  const palletFlags = pallets.filter((pallet) => Object.prototype.hasOwnProperty.call(state.flags, pallet.id));
  const currentMachinePallet = pallets.find((pallet) => pallet.location === 'machine');

  if (palletFlags.length > 0) {
    for (const pallet of palletFlags) {
      pallet.location = state.flags[pallet.id] ? 'rack' : 'unknown';
      pallet.rackSlot = state.flags[pallet.id] ? pallet.id : null;
    }
  }

  if (state.flags[18] && currentMachinePallet) {
    currentMachinePallet.location = 'machine';
  }

  machineOccupied = Boolean(state.flags[18]);
  handEmpty = !state.flags[20];
  robotBusy = Boolean(state.userOutputs[3]);
  render();
}

async function refreshIoState() {
  try {
    const state = await readIoState();
    if (Object.keys(state.flags).length > 0) {
      applyIoState(state);
    }
  } catch (error) {
    setRobotStatus('Error', `Could not read robot state: ${error.message}`);
  }
}

async function readIoState() {
  const response = await fetch(IO_STATE_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`IOSTATE.DG returned HTTP ${response.status}`);
  return parseIoState(await response.text());
}

async function refreshQueueManagerState() {
  try {
    const response = await fetch(NUMERIC_REGISTERS_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`NUMREG.VA returned HTTP ${response.status}`);
    const responseText = await response.text();
    const stateMatch = responseText.match(/\[117\]\s*=\s*(-?\d+)/i);
    if (!stateMatch) return;

    const getRegister = (register) => {
      const match = responseText.match(new RegExp(`\\[${register}\\]\\s*=\\s*(-?\\d+)`, 'i'));
      return match ? Number(match[1]) : null;
    };
    const queueLength = getRegister(119);
    if (queueLength !== null && queueLength >= 0 && queueLength <= MAX_QUEUE_LENGTH) {
      controllerQueue = Array.from({ length: queueLength }, (_, index) => {
        const program = getRegister(120 + index);
        const palletId = getRegister(123 + index);
        return {
          palletId,
          action: program === 1 ? 'machine' : 'rack'
        };
      }).filter((task) => task.palletId !== null);
      render();
    }

    const managerState = Number(stateMatch[1]);
    if (managerState === 1) {
      setRobotStatus('Busy', 'multitsk.kl is executing the controller queue.');
    } else if (managerState === 2) {
      setRobotStatus('Idle', 'Controller queue complete.');
    } else if (managerState === 0) {
      setRobotStatus('Idle', 'multitsk.kl is idle and waiting for queued work.');
    } else if (managerState < 0) {
      setRobotStatus('Error', `multitsk.kl reported controller error ${Math.abs(managerState)}.`);
    }
  } catch (error) {
    setRobotStatus('Error', `Could not read multitsk state: ${error.message}`);
  }
}

async function writeRobotRegister(registerIndex, value) {
  const params = new URLSearchParams({
    sValue: String(value),
    sIndx: String(registerIndex),
    sRealFlag: '-1',
    sFc: '2'
  });

  const response = await fetch(`${KCL_COMSET_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Could not write R[${registerIndex}]: HTTP ${response.status}`);
  }
}

async function enqueueSelectedPallet(action) {
  if (queueSubmitting) return;

  const selected = getSelectedPallet();
  if (!selected) {
    setRobotStatus('Idle', 'Select a pallet before queueing it.');
    return;
  }

  if (controllerQueue.length >= MAX_QUEUE_LENGTH) {
    setRobotStatus('Error', `Queue is full. Maximum ${MAX_QUEUE_LENGTH} queued actions.`);
    return;
  }

  const actionIsMachine = action === 'machine';
  const actionIsRack = action === 'rack';
  const invalidForMachine = actionIsMachine && (!handEmpty || selected.location !== 'rack' || selected.processed || machineOccupied);
  const invalidForRack = actionIsRack && (selected.location !== 'machine' || !handEmpty);

  if (invalidForMachine || invalidForRack) {
    setRobotStatus('Error', `Pallet ${selected.id} cannot be queued for ${formatQueueAction(action)} right now.`);
    return;
  }

  try {
    queueSubmitting = true;
    render();
    const program = getTaskProgramSet(action)[0];
    await writeRobotRegister(111, program);
    await writeRobotRegister(114, selected.id);
    await writeRobotRegister(110, 1);
    setRobotStatus('Busy', `Pallet ${selected.id} submitted to the multitsk.kl controller queue.`);
    await refreshQueueManagerState();
  } catch (error) {
    setRobotStatus('Error', `Could not submit pallet to controller queue: ${error.message}`);
  } finally {
    queueSubmitting = false;
    render();
  }
}

function render() {
  renderTable();
  renderQueue();
  updateSummaryCards();
}

async function movePalletToMachine() {
  enqueueSelectedPallet('machine');
}

async function movePalletToRack() {
  enqueueSelectedPallet('rack');
}

function machineReady() {
  return !pallets.some((pallet) => pallet.location === 'machine');
}

moveToMachineBtn.addEventListener('click', movePalletToMachine);
moveToRackBtn.addEventListener('click', movePalletToRack);
refreshQueueBtn.addEventListener('click', refreshQueueManagerState);

themeToggle.addEventListener('click', () => {
  document.body.classList.toggle('dark');
  const isDark = document.body.classList.contains('dark');
  themeToggle.innerHTML = `<span class="icon">${isDark ? '🌙' : '☀️'}</span><span class="label">${isDark ? 'Dark' : 'Light'}</span>`;
});

render();
refreshIoState();
refreshQueueManagerState();
window.setInterval(refreshIoState, 1000);
window.setInterval(refreshQueueManagerState, 1000);
