/**
 * AgentRuntime owns the actual task-execution logic for this agent.
 *
 * This is the extension point: replace `execute()` with whatever this
 * particular agent does (data analysis, document processing, calling out
 * to a model, etc). Nothing about credit verification, idempotency, or
 * HTTP handling lives here — this class only turns a validated task string
 * into a result payload.
 *
 * It deliberately does NOT eval/exec the task input as code — task content
 * is treated as opaque data to be interpreted by the agent's own logic
 * (e.g. passed as a prompt, or parsed as structured input it understands),
 * never executed as a script.
 */
export interface TaskExecutionResult {
  result: Record<string, unknown>;
}

export class TaskExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskExecutionError";
  }
}

export class AgentRuntime {
  constructor(private readonly capabilities: string[]) {}

  /**
   * Executes a validated task. Timeouts are enforced by the caller
   * (see routes/run.ts), so this should not need its own timeout logic
   * unless it calls slow external services, in which case those calls
   * should carry their own bounded timeouts too.
   */
  async execute(task: string): Promise<TaskExecutionResult> {
    if (task.trim().length === 0) {
      throw new TaskExecutionError("Task is empty after trimming.");
    }

    // --- Extension point -------------------------------------------------
    // Replace this block with the agent's real capability, e.g.:
    //   - run a data-analysis pipeline over an attached dataset reference
    //   - call an LLM with `task` as the prompt and parse structured output
    //   - process a document referenced by URL/hash in `task`
    //
    // The stub below just demonstrates a deterministic, side-effect-free
    // response shape so the API contract can be tested end-to-end without
    // pretending a specific business capability is implemented.
    const result = {
      summary: `Processed task of ${task.length} characters.`,
      capabilities: this.capabilities,
      receivedAt: new Date().toISOString()
    };
    // ----------------------------------------------------------------------

    return { result };
  }
}
