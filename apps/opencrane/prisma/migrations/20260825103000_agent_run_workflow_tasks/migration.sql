-- CreateTable
CREATE TABLE "agent_run_workflow_tasks" (
    "run_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "silo_id" TEXT NOT NULL,
    "task_key" TEXT NOT NULL,
    "task_name" TEXT NOT NULL,
    "task_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receipt_bound_at" TIMESTAMP(3),

    CONSTRAINT "AgentRunWorkflowTask_pkey" PRIMARY KEY ("run_id", "attempt")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentRunWorkflowTask_task_id_key" ON "agent_run_workflow_tasks"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRunWorkflowTask_silo_id_task_key_key" ON "agent_run_workflow_tasks"("silo_id", "task_key");

-- AddForeignKey
ALTER TABLE "agent_run_workflow_tasks" ADD CONSTRAINT "AgentRunWorkflowTask_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
