# agent-desk 설계

Claude Code와 Codex에 작업을 보내고, 진행 상황을 한 화면에서 보는 개인용 데스크톱 앱.

- 상태: **설계 확정, 사용자 최종 검토 대기** (2026-10-02)
- 위치: `C:\Users\User\tool_manager\agent-desk\`
- 다음 단계: 이 문서 검토 → 구현 계획 작성

## 0. 범위

| 항목 | 결정 |
|---|---|
| 목적 | 작업 지시·분배 + 진행 상황 보기 |
| 형태 | 데스크톱 앱 (Electron + React + TypeScript) |
| 분배 방식 | 작업마다 ① 사용자가 Claude/Codex 직접 지정, 또는 ② 두 AI가 상의해서 담당 결정(7절, 실행 전 사용자 확인). 서로 다른 작업은 동시에 실행 가능 |
| 현황 범위 | 이 앱에서 보낸 작업만 (Claude 데스크톱·Codex 앱에서 직접 연 세션은 읽지 않음) |
| 한도 도달 | 세션을 저장해 두고 [이어서 하기] 버튼으로 재개(6절). 자동 재개 없음 |
| 사용자 | 본인 1명, 이 PC(Windows)에서만 |
| 대상 저장소 | 기본 `C:\Users\User\Capstone`, 다른 git 폴더도 선택 가능 |
| 요금제 | Claude Pro 구독, Codex 무료. 작업별 실제 과금 없음(5절) |

처음 버전에서 하지 않는 것: 설치 파일 패키징(`npm start`로 실행), 자동 merge, 외부 세션 가져오기, 자동 재개, 설정 화면, 검색·필터, 다크모드 전환, 알림, 화면(React) 테스트.

## 1. 구조

- **메인 프로세스 (Node)**
  - `TaskRunner`: 작업 하나를 받아 CLI를 실행하고, 출력 줄을 화면으로 보내고, 종료 시 결과를 기록
  - `claudeAdapter` / `codexAdapter`: 실행 인자 만들기(새 작업·재개·의견 요청) + 각 도구의 JSON 출력을 공통 이벤트(`text` / `tool` / `done` / `error`)로 변환 + 한도·오류 구분
  - `Consultant`: 상의 모드(7절) — 두 AI 의견 수집과 담당 결정
  - `WorktreeManager`: 작업별 `git worktree` 생성·변경 파일 조회·정리
  - `TaskStore`: 작업 요약을 앱 데이터 폴더 `tasks.json`에 저장. 원본 출력은 `logs/<작업ID>.jsonl`
- **preload**: 화면에 허용된 기능만 노출(작업 시작·중지·재개·확정·정리·목록·이벤트 구독). `contextIsolation` 켬, `nodeIntegration` 끔
- **화면 (React + Vite)**: 3절

작업 기록(`tasks.json`의 한 항목)이 담는 것: 작업 ID, 저장소 경로, 지시문, 담당 AI(+ 상의 결과), 상태, worktree 경로·브랜치, 세션 ID, 사용량(Claude 추정 $ / Codex 토큰), 바뀐 파일 요약, 생성·종료 시각.

상태: `consulting` → `running` → `done` / `failed` / `cancelled` / `limited` / `interrupted`. `limited`·`interrupted`에서 [이어서 하기]로 다시 `running`.

## 2. 작업 실행 흐름

1. **보내기**: 저장소, 담당 AI(Claude / Codex / 상의해서 정하기), 지시문, 사용량 상한(Claude 실행 시) 입력 → 작업 ID 발급. 상의 모드면 7절을 먼저 거친다
2. **준비**: git 저장소인지 확인 → `<저장소 상위>/.tm-worktrees/<저장소이름>/<작업ID>`에 `tm/<작업ID>` 브랜치로 worktree 생성(원본 폴더 안에는 아무것도 만들지 않음). 원본에 커밋 안 된 변경이 있으면 "작업에 포함되지 않음" 경고
3. **실행** (작업 폴더 = worktree)
   - Claude: `claude -p <지시문> --output-format stream-json --verbose --permission-mode acceptEdits --max-budget-usd <상한>`
   - Codex: `codex exec --json -s workspace-write -C <worktree> <지시문>`
   - 지시문은 인자 배열로 전달(`shell: false`)해 셸 해석을 막는다
   - Codex 실행 파일은 `%LOCALAPPDATA%\OpenAI\Codex\bin\*\codex.exe` 중 가장 최근 것을 앱이 직접 찾는다(앱 업데이트마다 폴더가 바뀜. `~/bin/codex` sh 스크립트는 Electron이 실행하지 못함)
4. **실시간 표시**: 출력 줄 → 어댑터 → 공통 이벤트 → 화면. 원본은 `logs/<작업ID>.jsonl`에 보관. 출력에서 세션 ID를 잡아 저장
5. **완료**: 종료 코드, 바뀐 파일(`git status --porcelain`, `git diff --stat`), 사용량을 기록하고 상태 확정
6. **정리**: [폴더 열기](검토·커밋·merge는 사용자가 직접), [정리](확인 후 worktree와 `tm/<작업ID>` 브랜치 삭제)

- 중지: 프로세스 트리 종료(`taskkill /T /F`) → `cancelled`
- 실행 중 앱 종료: 다음 실행 때 `running`으로 남은 작업을 `interrupted`로 표시

## 3. 화면

```
┌──────────────────────┬─────────────────────────────────────────┐
│ [+ 새 작업]           │ Claude · Capstone · tm/7f3a   ● 실행 중  │
│──────────────────────│ 추정 $0.42 / 상한 $2.00        [중지]    │
│ ● Claude  리뷰 노트…  │─────────────────────────────────────────│
│   실행 중 · 2분       │ 💬 backend 테스트를 먼저 읽어볼게요       │
│ ✓ Codex   타입 오류…  │ 🔧 Read backend/app/deps.py              │
│   완료 · 토큰 18k     │ 🔧 Edit backend/app/routers/sessions.py  │
│ ⏸ Codex   한도 도달   │ ...                                     │
│                      │─────────────────────────────────────────│
│                      │ (완료 후) 바뀐 파일 3개  +42 −7           │
│                      │ [폴더 열기]  [정리]                       │
└──────────────────────┴─────────────────────────────────────────┘
```

- **왼쪽 작업 목록**: 상태 아이콘, 담당 AI, 지시문 첫 줄, 경과 시간, 사용량. 최신이 위
- **오른쪽 작업 상세**
  - 헤더: 담당 AI·저장소·브랜치·상태·사용량. 실행 중이면 [중지], `limited`/`interrupted`면 [이어서 하기](초기화 시각을 알면 "HH:MM 이후 재개 가능")
  - 실시간 로그: AI 글은 말풍선, 도구 사용은 한 줄로 접어 두고 펼치기
  - 완료 후: 바뀐 파일·줄 수, [폴더 열기] / [정리]
  - `consulting` 단계: 두 AI 의견 나란히 + 결정·이유·계획 + [이대로 실행] / [다른 AI로 실행] / [취소]
- **새 작업 창**: 저장소(기본 Capstone, 마지막 사용 기억, 폴더 선택), 담당 AI, 지시문(여러 줄), 사용량 상한(Claude 실행 시, 기본 $2), 커밋 안 된 변경 경고, 종량제 환경변수 경고(5절)

## 4. 오류 처리

| 상황 | 감지 | 표시·대응 |
|---|---|---|
| CLI 없음 | 실행 실패(`ENOENT`), codex.exe 검색 실패 | "Claude/Codex가 설치돼 있지 않습니다", 작업 시작 안 함 |
| 로그인 안 됨 | 인증 오류 메시지 | `failed`, "터미널에서 로그인하세요" 안내 |
| 사용량 한도 도달 | 한도 관련 오류 메시지·이벤트 | `limited`, 초기화 시각 표시, [이어서 하기] |
| 사용량 상한 도달 | Claude 결과 이벤트 | `limited`, 상한을 올려 이어서 하기 |
| JSON 아닌 출력 | 줄 단위 파싱 실패 | 원문 그대로 로그에 표시, 작업은 계속 |
| 비정상 종료 | 종료 코드 ≠ 0 | `failed`, 마지막 오류 출력 표시 |
| worktree 생성 실패 | git 오류 | 작업 시작 안 함, git 메시지 그대로 표시 |
| 앱 종료로 중단 | 재시작 시 `running`으로 남은 작업 | `interrupted`, 세션 ID 있으면 [이어서 하기] |
| 상의 단계 실패 | 한쪽 또는 양쪽 의견 실패 | 7절 대체 규칙 |

한도 메시지의 정확한 문구는 실제로 겪어 봐야 안다. 처음에는 넓게 판단하고, 판단에 쓴 원문을 항상 로그에 남겨 기준을 고칠 수 있게 한다.

## 5. 사용량 상한과 요금

- **현재 요금제 (2026-10-02)**: Claude Pro 구독, Codex 무료 → 어느 쪽도 작업별 과금 없음. 이 PC에는 `ANTHROPIC_API_KEY`·`OPENAI_API_KEY`가 설정돼 있지 않음을 확인함
- **Claude**: `--max-budget-usd`를 그대로 쓴다. 구독 로그인에서 표시 금액은 사용량을 API 요금으로 환산한 추정치이고 청구되지 않는다. 상한은 "작업 하나가 Pro 사용량 한도를 다 먹지 않게 막는 장치". 화면 표기 "사용량 상한 (API 환산 추정 $)", 기본 $2, 작업마다 변경 가능
  - 구독 로그인에서 이 옵션이 추정 금액 기준으로 실제로 멈추는지 구현 첫 단계에서 확인한다. 멈추지 않으면 앱이 `stream-json`의 누적 사용량을 보고 직접 중지한다
- **Codex**: CLI에 상한 옵션이 없어 토큰 사용량만 표시한다. 무료 요금제라 한도 도달이 잦을 수 있어 `limited`로 구분해 보여 준다
- `ANTHROPIC_API_KEY`·`OPENAI_API_KEY`가 잡혀 있으면 CLI가 종량제로 결제하므로 새 작업 창에서 경고한다

## 6. 한도 도달 후 이어서 하기

- 작업 시작 시 출력에서 세션 ID를 저장한다(Claude `stream-json`의 init 이벤트, Codex `--json`의 세션 이벤트)
- [이어서 하기] → 같은 worktree에서 같은 세션 재개
  - Claude: `claude -p --resume <세션ID> --output-format stream-json --verbose --permission-mode acceptEdits --max-budget-usd <상한> "이어서 진행해줘"`
  - Codex: `codex exec resume <세션ID> --json "이어서 진행해줘"` (작업 폴더 = worktree)
- 여러 번 끊겼다 이어져도 로그·사용량은 한 작업 기록에 이어 붙인다
- 자동 재개는 하지 않는다(사용자 결정)

## 7. 상의해서 담당 정하기

1. **한도 규칙 먼저**: 한쪽이 `limited`이고 초기화 시각이 아직 안 지났으면 상의 없이 다른 쪽을 추천한다
2. **의견 받기** (병렬, 읽기 전용, worktree 없이 원본 저장소에서): 같은 요청을 두 AI에 보내 정해진 JSON으로 의견을 받는다
   - 형식: `{ "approach": 접근법, "difficulty": 1~5, "fit": "me" | "other" | "either", "reason": 이유 }`
   - Claude: `claude -p --permission-mode plan --output-format json --max-budget-usd 0.3`
   - Codex: `codex exec --json -s read-only -C <원본 저장소>`
3. **결정**: 두 의견이 같은 담당을 가리키면 추가 호출 없이 결정. 갈리면 Claude가 두 의견을 보고 `{ "assignee": "claude" | "codex", "reason": 이유, "plan": 실행 계획 }`으로 정리
4. **사용자 확인**: 두 의견과 결정을 나란히 보여 주고 [이대로 실행] / [다른 AI로 실행] / [취소]
5. **실행**: 담당 AI의 지시문 = 원래 요청 + "합의된 계획: <plan>". 이후는 2절 흐름

- 한쪽 의견이 실패하면(한도, 시간 초과, JSON 형식 오류) 남은 쪽 의견만으로 결정. 둘 다 실패하면 사용자가 직접 고른다
- 상의 단계의 로그와 사용량도 그 작업 기록에 남긴다

## 8. 테스트

- **단위 테스트 (Vitest)**: 어댑터 인자 생성(새 작업·재개·의견), 출력 JSON → 공통 이벤트 변환, 한도·오류 구분, 상의 결과 파싱과 결정 규칙
  - 출력 샘플은 구현 첫 단계에서 두 CLI를 실제로 한 번씩 돌려 `fixtures/`에 저장해 쓴다
- **통합 테스트**: 임시 git 저장소에서 worktree 생성 → 변경 파일 조회 → 정리
- **실제 동작 확인**: 작은 작업 하나를 Claude 지정 / Codex 지정 / 상의 모드로 각각 실행. 사용량을 쓰므로 실행 전에 사용자에게 확인
- 화면(React) 테스트는 처음 버전에서 하지 않는다

## 9. 구현 첫 단계에서 확인할 것

- Claude `stream-json`·Codex `--json`의 실제 이벤트 형식(세션 ID, 사용량, 한도 오류가 어디에 오는지)
- 구독 로그인에서 `--max-budget-usd`가 실제로 멈추는지(5절)
- `--permission-mode plan` + `--output-format json` 조합으로 의견 JSON을 안정적으로 받을 수 있는지(7절)

## 10. 다른 곳에서 연 세션 보기 (2026-10-02 추가)

0절의 "이 앱에서 보낸 작업만" 범위를 넓힌다. 다른 곳(Claude 데스크톱·VS Code·Codex 앱)에서 연 세션을 **읽기 전용**으로 보여 준다. 중지·이어서 하기는 없다. 기록 형식은 공개된 형식이 아니라서, 읽지 못한 파일은 그 세션만 건너뛴다.

| | Claude | Codex |
|---|---|---|
| 목록 | `~/.claude/sessions/<pid>.json` (실행 중인 세션 등록부. `.key` 파일은 열지 않음) | `~/.codex/sessions/**/rollout-*.jsonl` 중 24시간 안에 바뀐 것, 최대 10개. 이름은 `session_index.jsonl` |
| 진행 중 | `status` = `busy` + 해당 pid가 살아 있음. pid가 죽었으면 목록에서 뺀다 | 마지막 `task_started` 뒤에 `task_complete`가 없고, 10분 안에 기록이 바뀜 |
| 마지막 메시지 | `~/.claude/projects/*/<sessionId>.jsonl` 끝부분의 마지막 글 | rollout 끝부분의 마지막 assistant 메시지 |

- agent-desk가 실행한 작업(작업 폴더가 `.tm-worktrees` 아래)은 제외한다(이미 작업 목록에 있음)
- 화면이 5초마다 다시 읽는다(Windows 파일 감시가 불안정해 감시 대신 주기적으로 읽음)
- 큰 기록 파일은 끝부분 64KB만 읽는다

## 11. 사용량 % 막대 (2026-10-02 추가)

- **Claude Pro**: `rate_limit_event.rate_limit_info.unifiedWindows`의 `five_hour`·`seven_day` `utilization`(0~1)과 `resetsAt`. agent-desk가 Claude를 실행할 때만 갱신되므로 마지막 값을 `quota.json`에 저장하고 "확인 시각"을 함께 표시
- **Codex 무료**: 가장 최근 rollout의 마지막 `token_count` 이벤트 `rate_limits.primary`/`secondary`의 `used_percent`, `window_minutes`, `resets_at`. Codex 앱 사용분까지 반영된다
- 작업별: Claude 작업이 끝나면 이번 실행 금액 / 1회 상한 %를 막대로 표시. 실행 중에는 금액이 나오지 않아(결과 줄에만 있음) 움직이는 막대 + 경과 시간 + 도구 사용 횟수로 표시
- 작업 완료율(%)은 표시하지 않는다. AI의 남은 단계를 알 수 없어 가짜 숫자가 되기 때문
- 80% 이상이면 경고색

## 12. 다크 테마 (2026-10-02 추가)

- 색: 바탕 `#0E131B`, 패널 `#161D28`, 선 `#283244`, 글자 `#E4E9F1`, 보조 글자 `#93A0B4`, Claude `#F0B45E`, Codex `#5BC6E8`, 실패 `#F07C7C`, 경고 `#E9C46A`. 글자 대비 4.5:1 이상
- 글꼴: Segoe UI Variable + 맑은 고딕, 크기 13/14/16/20px. 도구 사용 줄·경로만 Cascadia Code(고정폭)
- AI 색 막대(목록 항목·로그 줄 왼쪽)가 화면의 유일한 강조 요소. 이모지와 "A · B · C" 식 정보 줄은 쓰지 않고 이름 붙은 줄로 표시
- 움직임은 "진행 중" 점의 느린 깜빡임 하나. `prefers-reduced-motion`이면 멈춤. 포커스 테두리는 밝은 흰 계열

## 13. 요금제·모델 표시와 작업별 모델 선택 (2026-10-02 추가)

배포 시 각 사용자 PC의 자기 로그인 정보로 동작한다. 개인정보(이메일·이름·계정 ID)와 로그인 토큰은 읽거나 저장하지 않고, 아래 값만 골라 읽는다. `~/.codex/auth.json`은 열지 않는다.

| | Claude | Codex |
|---|---|---|
| 요금제 | `~/.claude.json` `oauthAccount.organizationType`(`claude_pro` → Claude Pro, `claude_max` → Claude Max). `oauthAccount`가 없으면 "API 키(종량제)" | 최근 rollout `token_count.rate_limits.plan_type`(`free` → 무료, `plus` → Plus, `pro` → Pro). 없으면 "확인 불가" |
| 사용률 | `~/.claude.json` `cachedUsageUtilization.utilization`의 `five_hour`·`seven_day`(0~100). agent-desk가 받은 값(11절)과 비교해 더 최근 것을 쓴다 | 11절 그대로 |
| 고를 수 있는 모델 | 기본(설정값), `sonnet`, `opus`, `haiku` + `additionalModelOptionsCache`의 값 | `~/.codex/models_cache.json` `models` 중 `visibility` = `list` |
| 실제로 쓴 모델 | `stream-json` init 줄의 `model` | 세션 ID로 찾은 rollout의 `turn_context.payload.model` |

- 새 작업 창에서 담당 AI별 모델을 고른다(기본값은 "기본 설정"). 상의 모드는 두 AI 모두 고를 수 있고, 의견 요청은 늘 기본 설정으로 실행한다
- 실행 인자: Claude `--model <값>`, Codex `-m <값>`(`exec`과 `exec resume` 모두). 고르지 않으면 인자를 넣지 않는다
- 작업 상세에 실제로 쓴 모델을 표시한다
- 형식이 바뀌어 읽지 못하면 그 항목만 "확인 불가"로 표시한다

## 14. 구독 사용률 보호선과 추가 요금 방지 (2026-10-02 추가)

$ 상한(5절)은 요금제마다 의미가 달라, 요금제와 무관한 %로 보호한다. **사용자 결정(2026-10-02)으로 작업 실행·재개의 $ 상한(`--max-budget-usd`)과 그 입력칸·막대는 없앴다.** 상의 모드의 의견 요청만 화면에 보이지 않는 내부 상한 $0.3을 유지한다. 실행 중 보호는 구독 한도 도달 시 `limited`(재개 가능)와 추가 요금 구간 즉시 중지가 맡는다. 추가 요금이 생길 수 있는 상황에서는 agent-desk가 자동으로 진행하지 않고 사용자가 공식 도구에서 직접 관리하게 한다.

**보내기 전 검사** (해당 AI의 사용률 창 중 가장 높은 값 기준)
- 80% 이상: 경고만 표시하고 보낼 수 있음
- 90% 이상: 보내기를 막고 [직접 세션 열기]를 안내. 메인 프로세스(createTask·confirmTask)에서도 같은 검사를 한다
- 상의 모드: 한쪽만 막혔으면 상의 없이 다른 쪽에 배정, 둘 다 막혔으면 보내기 막음
- 사용률을 모르면(정보 없음) 검사하지 않는다
- 한계: Claude 사용률은 실행 시작 때 한 번 들어오므로 실행 도중 %로 멈추지는 못한다

**추가 요금**
- 감지: Claude `oauthAccount.hasExtraUsageEnabled`, Codex `rate_limits.credits.has_credits`. 켜져 있으면 사용량 칸과 새 작업 창에 "한도를 넘으면 실제 요금이 청구될 수 있음"을 표시
- Claude 실행 중 `rate_limit_event.rate_limit_info.isUsingOverage` = true가 오면 즉시 프로세스를 끝내고 `limited`("추가 요금 구간에 들어가 멈춤")로 표시
- Codex는 실행 출력에 이 정보가 없어 실행 중 감지는 못 하고 경고만 한다

**직접 세션 열기**
- 새 터미널 창에서 공식 도구를 대화형으로 연다. 작업이 있으면 그 worktree에서 세션을 이어서(`claude --resume <id>`, `codex resume <id>`), 없으면 저장소 폴더에서 새로 연다
- 세션 ID는 영문·숫자·`-`만 허용(명령 주입 방지), 실행은 `cmd /c start`에 인자 배열로 넘긴다
