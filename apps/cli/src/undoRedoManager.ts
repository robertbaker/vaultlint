/**
 * Generic undo/redo state history manager. Supports dependency injection of isolated history
 * instances per session/workspace while preserving module-level convenience helpers.
 */
export class UndoRedoHistory<T = unknown> {
  private historyStack: string[] = [];
  private redoStack: string[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 100) {
    this.maxEntries = maxEntries;
  }

  /** Record a state snapshot before a mutation and clear any forward redo branch. */
  add(currentState: T): void {
    this.historyStack.push(JSON.stringify(currentState));
    if (this.historyStack.length > this.maxEntries) {
      this.historyStack.shift();
    }
    this.redoStack = [];
  }

  /** Undo the last action and return the previous state. */
  undo(currentState: T): T {
    const lastState = this.historyStack.pop();
    if (lastState === undefined) {
      console.log("No actions to undo.");
      return currentState;
    }

    this.redoStack.push(JSON.stringify(currentState));
    return JSON.parse(lastState) as T;
  }

  /** Redo the last undone action and return the restored state. */
  redo(currentState: T): T {
    const nextState = this.redoStack.pop();
    if (nextState === undefined) {
      console.log("No actions to redo.");
      return currentState;
    }

    this.historyStack.push(JSON.stringify(currentState));
    return JSON.parse(nextState) as T;
  }

  get canUndo(): boolean {
    return this.historyStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.historyStack = [];
    this.redoStack = [];
  }
}

const defaultHistory = new UndoRedoHistory();

/** Add a state snapshot to the default history for undo/redo purposes. */
export function addToHistory<T>(currentState: T): void {
  defaultHistory.add(currentState);
}

/** Undo the last action on the default history and return the previous state. */
export function undo<T>(vaultData: T): T {
  return (defaultHistory as UndoRedoHistory<T>).undo(vaultData);
}

/** Redo the last undone action on the default history and return the restored state. */
export function redo<T>(vaultData: T): T {
  return (defaultHistory as UndoRedoHistory<T>).redo(vaultData);
}

export function canUndo(): boolean {
  return defaultHistory.canUndo;
}

export function canRedo(): boolean {
  return defaultHistory.canRedo;
}

export function clearHistory(): void {
  defaultHistory.clear();
}

export interface TrackedMutationResult<T> {
  /** The state to keep using: `current` on success, a restored copy if the mutation failed. */
  state: T;
  /** True when the mutation changed the state and an undo entry was recorded. */
  changed: boolean;
  error?: Error;
}

/**
 * Run an in-place mutation and record an undo entry only if it succeeded and actually changed the
 * state. A failed mutation leaves no undo entry and its partial changes are rolled back.
 */
export async function runTracked<T>(
  current: T,
  mutate: (state: T) => void | Promise<void>,
  history: UndoRedoHistory<T> = defaultHistory as UndoRedoHistory<T>,
): Promise<TrackedMutationResult<T>> {
  const snapshot = JSON.stringify(current);
  try {
    await mutate(current);
  } catch (error) {
    return {
      state: JSON.parse(snapshot) as T,
      changed: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
  if (JSON.stringify(current) === snapshot) return { state: current, changed: false };
  history.add(JSON.parse(snapshot) as T);
  return { state: current, changed: true };
}
