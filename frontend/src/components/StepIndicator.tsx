import type { Stage } from '../types';
import { Check } from 'lucide-react';

interface Props {
  currentStage: Stage;
}

const STEPS: { stage: Stage; label: string }[] = [
  { stage: 'upload', label: 'Upload' },
  { stage: 'configure', label: 'Configure' },
  { stage: 'processing', label: 'Process' },
  { stage: 'results', label: 'Results' },
];

const stageOrder: Record<Stage, number> = {
  upload: 0,
  configure: 1,
  processing: 2,
  results: 3,
};

export function StepIndicator({ currentStage }: Props) {
  const currentIdx = stageOrder[currentStage];

  return (
    <div className="flex items-center justify-center gap-0 px-6 py-3 bg-card border-b">
      {STEPS.map((step, i) => {
        const isCompleted = i < currentIdx;
        const isActive = i === currentIdx;

        return (
          <div key={step.stage} className="flex items-center">
            {/* Step circle */}
            <div className="flex items-center gap-2">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                  isCompleted
                    ? 'bg-primary text-primary-foreground'
                    : isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'border-2 border-muted-foreground/30 text-muted-foreground'
                }`}
              >
                {isCompleted ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <span
                className={`text-xs font-medium ${
                  isActive ? 'text-primary' : isCompleted ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                {step.label}
              </span>
            </div>
            {/* Connector line */}
            {i < STEPS.length - 1 && (
              <div
                className={`w-12 h-px mx-3 ${
                  i < currentIdx ? 'bg-primary' : 'bg-muted-foreground/30'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
