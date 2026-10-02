# CLI 출력 메모 (2026-10-02 수집)

Claude Code(Pro 구독 로그인), Codex CLI 0.159.0-alpha.12.1(무료). 원본은 `fixtures/`.

| 항목 | Claude (`claude -p --output-format stream-json --verbose`) | Codex (`codex exec --json`) |
|---|---|---|
| 세션 ID | `system`/`init` 줄의 `session_id` (모든 줄에 같은 값이 붙음) | `thread.started` 줄의 `thread_id` |
| 최종 답변 텍스트 | `result` 줄의 `result` | 마지막 `item.completed`(`item.type` = `agent_message`)의 `item.text` |
| 사용량 | `result` 줄의 `total_cost_usd` | `turn.completed` 줄의 `usage.input_tokens + usage.output_tokens` |
| 성공 판정 | `result`의 `subtype` = `success`, `is_error` = false | `turn.completed` 존재 |
| 상한 초과 | `result`의 `subtype` = `error_max_budget_usd`, `is_error` = true, `errors: ["Reached maximum budget ($…)"]`, 종료 코드 1 | (상한 옵션 없음) |
| 한도 상태 | `rate_limit_event` 줄의 `rate_limit_info.status`(`allowed` 등)와 `resetsAt`(초 단위 에포크), `rateLimitType`(`five_hour`) | 이번엔 한도에 안 걸림. 문구 미확인 |
| 그 밖의 줄 | `system`의 `hook_started`/`hook_response`/`task_summary`/`post_turn_summary`, `user`(도구 결과) | `turn.started`, `item.started`, `item.completed`의 `item.type` = `error`(경고, 예: 스킬 목록 예산 초과) |

- 구독 로그인에서 `--max-budget-usd` 동작: **멈춤.** 단 턴이 끝난 뒤에 확인하므로 상한을 한 턴만큼 넘을 수 있다(상한 $0.0001에 $0.12 사용). → `budgetGuard` 대체 구현 불필요
- plan 모드 의견 JSON: **받음.** Claude·Codex 모두 순수 JSON 문자열로 답함
- 짧은 질문 한 번에도 Claude 추정 $0.12~0.15. 전역 플러그인·훅(SessionStart 등)이 매 실행마다 함께 로드되기 때문으로 보임. 상의 모드는 의견 2회(+결정 1회)라 추정 $0.3~0.45 정도 든다
- Codex 표준오류에 Figma·Context7 MCP 인증 오류가 매번 찍힘(작업과 무관)
