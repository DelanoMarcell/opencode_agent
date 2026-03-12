"use client";

import type { PermissionRequest, QuestionInfo, QuestionRequest } from "@opencode-ai/sdk/v2/client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  buildQuestionAnswer,
  createEmptyQuestionDraft,
  renderQuestionHints,
} from "@/lib/agent-runtime/helpers";
import type { QuestionDraft } from "@/lib/agent-runtime/types";

type AgentInteractivePanelProps = {
  activeQuestionIndexByRequest: Record<string, number>;
  onPermissionReply: (requestID: string, decision: "once" | "always" | "reject") => void;
  onQuestionCustomInputChange: (
    requestID: string,
    questionIndex: number,
    question: QuestionInfo,
    value: string
  ) => void;
  onQuestionOptionToggle: (
    requestID: string,
    questionIndex: number,
    question: QuestionInfo,
    optionLabel: string
  ) => void;
  onQuestionReply: (request: QuestionRequest) => void;
  onQuestionStepChange: (requestID: string, questionIndex: number) => void;
  pendingPermissions: Array<PermissionRequest>;
  pendingQuestions: Array<QuestionRequest>;
  questionDrafts: Record<string, Array<QuestionDraft>>;
};

export function AgentInteractivePanel({
  activeQuestionIndexByRequest,
  onPermissionReply,
  onQuestionCustomInputChange,
  onQuestionOptionToggle,
  onQuestionReply,
  onQuestionStepChange,
  pendingPermissions,
  pendingQuestions,
  questionDrafts,
}: AgentInteractivePanelProps) {
  if (pendingQuestions.length === 0 && pendingPermissions.length === 0) {
    return null;
  }

  return (
    <section
      className="min-w-0 max-h-56 space-y-2 overflow-y-auto border-t-2 p-3"
      aria-live="polite"
    >
      {pendingQuestions.map((request) => {
        const requestDrafts = questionDrafts[request.id] ?? [];
        const questionCount = request.questions.length;
        const activeQuestionIndex = Math.min(
          activeQuestionIndexByRequest[request.id] ?? 0,
          Math.max(questionCount - 1, 0)
        );
        const activeQuestion = request.questions[activeQuestionIndex];
        const activeDraft = requestDrafts[activeQuestionIndex] ?? createEmptyQuestionDraft();
        const answeredCount = request.questions.reduce(
          (count, question, index) =>
            count + (buildQuestionAnswer(question, requestDrafts[index]).length > 0 ? 1 : 0),
          0
        );

        return (
          <article key={request.id} className="agent-interactive min-w-0 border-2 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-(--ink-muted)">
                  Question
                </p>
                <p className="mt-1 text-xs text-(--ink-soft)">
                  {answeredCount} of {questionCount} answered
                </p>
              </div>
              <Badge
                variant="secondary"
                className="rounded-none border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]"
              >
                {questionCount > 0 ? `${activeQuestionIndex + 1} / ${questionCount}` : "0 / 0"}
              </Badge>
            </div>

            {questionCount > 1 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {request.questions.map((question, index) => {
                  const answered = buildQuestionAnswer(question, requestDrafts[index]).length > 0;
                  const isActive = index === activeQuestionIndex;

                  return (
                    <button
                      key={`${request.id}-step-${question.header}-${index}`}
                      type="button"
                      className="agent-question-step min-w-[120px] px-3 py-2"
                      data-active={isActive}
                      data-answered={answered}
                      onClick={() => onQuestionStepChange(request.id, index)}
                    >
                      <span className="block text-left text-xs font-semibold uppercase tracking-[0.08em]">
                        {question.header || `Question ${index + 1}`}
                      </span>
                      <span className="mt-1 block text-left text-[11px] text-(--ink-soft)">
                        {answered ? "Answered" : "Pending"}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {activeQuestion ? (
              <div className="mt-4 min-w-0 space-y-3 border-t-2 pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-(--ink-muted)">
                    {activeQuestion.header || `Question ${activeQuestionIndex + 1}`}
                  </p>
                  <Badge
                    variant="secondary"
                    className="rounded-none border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]"
                  >
                    {activeQuestion.multiple ? "Multiple" : "Single"}
                  </Badge>
                  {activeQuestion.custom === false ? (
                    <Badge
                      variant="secondary"
                      className="rounded-none border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]"
                    >
                      Options Only
                    </Badge>
                  ) : null}
                </div>

                <p className="wrap-break-word whitespace-pre-wrap text-sm font-medium">
                  {activeQuestion.question}
                </p>
                <p className="wrap-break-word whitespace-pre-wrap text-xs text-(--ink-soft)">
                  {renderQuestionHints(activeQuestion)}
                </p>

                {activeQuestion.options.length > 0 ? (
                  <div className="space-y-2">
                    {activeQuestion.options.map((option, index) => {
                      const selected = activeDraft.selectedOptions.includes(option.label);

                      return (
                        <button
                          key={`${request.id}-${activeQuestionIndex}-${option.label}-${index}`}
                          type="button"
                          className="agent-question-option block w-full min-w-0 px-3 py-3"
                          data-selected={selected}
                          role={activeQuestion.multiple ? "checkbox" : "radio"}
                          aria-checked={selected}
                          onClick={() =>
                            onQuestionOptionToggle(
                              request.id,
                              activeQuestionIndex,
                              activeQuestion,
                              option.label
                            )
                          }
                        >
                          <div className="flex items-start gap-3">
                            <span
                              className={`agent-question-marker mt-0.5 flex size-5 shrink-0 items-center justify-center ${
                                activeQuestion.multiple ? "rounded-none" : "rounded-full"
                              }`}
                              aria-hidden="true"
                            >
                              {selected ? (
                                <span
                                  className={`block size-2.5 bg-(--brand-hover) ${
                                    activeQuestion.multiple ? "rounded-none" : "rounded-full"
                                  }`}
                                />
                              ) : null}
                            </span>
                            <div className="min-w-0 space-y-1">
                              <p className="wrap-break-word text-left text-sm font-medium">
                                {option.label}
                              </p>
                              <p className="wrap-break-word text-left text-xs text-(--ink-soft)">
                                {option.description}
                              </p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {activeQuestion.custom !== false ? (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-(--ink-muted)">
                      {activeQuestion.options.length > 0 ? "Custom Answer" : "Answer"}
                    </p>
                    <Textarea
                      value={activeDraft.customText}
                      onChange={(event) =>
                        onQuestionCustomInputChange(
                          request.id,
                          activeQuestionIndex,
                          activeQuestion,
                          event.target.value
                        )
                      }
                      placeholder={
                        activeQuestion.options.length > 0
                          ? activeQuestion.multiple
                            ? "Add any extra context or custom choices."
                            : "Type your own answer exactly as you want it sent."
                          : "Type your answer."
                      }
                      className="agent-field min-h-24 rounded-none border-2 shadow-none"
                    />
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t-2 pt-3">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={activeQuestionIndex === 0}
                      onClick={() => onQuestionStepChange(request.id, activeQuestionIndex - 1)}
                      className="agent-btn rounded-none border-2 shadow-none"
                    >
                      Previous
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={activeQuestionIndex >= questionCount - 1}
                      onClick={() => onQuestionStepChange(request.id, activeQuestionIndex + 1)}
                      className="agent-btn rounded-none border-2 shadow-none"
                    >
                      Next
                    </Button>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onQuestionReply(request)}
                    disabled={questionCount === 0 || answeredCount !== questionCount}
                    className="agent-btn-primary rounded-none border-2 shadow-none"
                  >
                    Send Answers
                  </Button>
                </div>
              </div>
            ) : null}
          </article>
        );
      })}

      {pendingPermissions.map((request) => (
        <article key={request.id} className="agent-interactive min-w-0 border-2 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-(--ink-muted)">
            Permission
          </p>
          <p className="mt-1 wrap-break-word whitespace-pre-wrap text-sm font-medium">
            {request.permission}
          </p>
          {request.patterns.length > 0 ? (
            <p className="mt-1 wrap-break-word whitespace-pre-wrap text-xs text-(--ink-soft)">
              patterns: {request.patterns.join(", ")}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onPermissionReply(request.id, "once")}
              className="agent-btn rounded-none border-2 shadow-none"
            >
              Once
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onPermissionReply(request.id, "always")}
              className="agent-btn rounded-none border-2 shadow-none"
            >
              Always
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => onPermissionReply(request.id, "reject")}
              className="rounded-none border-2 border-red-700 bg-red-700 text-white hover:bg-red-800"
            >
              Reject
            </Button>
          </div>
        </article>
      ))}
    </section>
  );
}
