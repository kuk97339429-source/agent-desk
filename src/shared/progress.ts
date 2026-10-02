// AI가 스스로 알려 주는 진행 표시 (docs/design.md 15절 B). 화면과 메인 프로세스가 같이 쓴다
import type { TaskStatus } from './types';

export const PROGRESS_HINT =
  '(진행 표시 요청) 작업을 단계로 나눠 진행하고, 각 단계를 시작할 때 다른 말보다 먼저 `[진행 n/N] 단계 이름` 형식의 한 줄을 써 주세요. N은 전체 단계 수입니다.';

export interface ProgressMark {
  step: number;
  total: number;
  label?: string;
}

const MARK = /\[진행\s*(\d+)\s*\/\s*(\d+)\]\s*([^\n]*)/g;

/** 글 속의 [진행 n/N] 표시를 모두 읽는다. 말이 안 되는 값(0단계, n > N)은 버린다 */
export function progressMarks(text: string): ProgressMark[] {
  const marks: ProgressMark[] = [];
  for (const m of text.matchAll(MARK)) {
    const step = Number(m[1]);
    const total = Number(m[2]);
    if (step < 1 || total < 1 || step > total) continue;
    const label = m[3].trim();
    marks.push(label ? { step, total, label } : { step, total });
  }
  return marks;
}

/** 글에서 마지막 [진행 n/N] 표시 */
export function parseProgress(text: string): ProgressMark | null {
  return progressMarks(text).at(-1) ?? null;
}

/** 시작한 단계는 아직 끝나지 않은 것으로 보고, 작업이 완료되면 100 */
export function progressPercent(mark: Pick<ProgressMark, 'step' | 'total'>, status: TaskStatus): number {
  if (status === 'done') return 100;
  return Math.round(((mark.step - 1) / mark.total) * 100);
}
