# 보안

agent-desk는 사용자 PC에서만 동작합니다. 서버가 없고, 앱 자체는 어떤 정보도 외부로 보내지 않습니다. 인터넷 통신은 앱이 실행하는 공식 `claude`·`codex` CLI가 각자의 서비스와 하는 것뿐입니다.

## 읽는 정보

필요한 값만 골라 읽고, 아래에 없는 값은 화면에 보이거나 저장되지 않습니다.

| 파일 | 읽는 값 | 쓰는 곳 |
|---|---|---|
| `~/.claude.json` | `oauthAccount.organizationType`(요금제), `oauthAccount.hasExtraUsageEnabled`(추가 사용), `cachedUsageUtilization`(사용률), `additionalModelOptionsCache`(모델 목록) | 사용량 칸, 모델 선택 |
| `~/.claude/sessions/<pid>.json` | 세션 ID, 작업 폴더, 세션 이름, 상태(busy/idle), 실행 위치 | 다른 곳에서 연 세션 |
| `~/.claude/projects/*/<세션ID>.jsonl` | 끝부분의 마지막 assistant 글 | 다른 곳에서 연 세션 |
| `~/.codex/sessions/**/rollout-*.jsonl` | 세션 ID, 작업 폴더, 작업 시작·완료 이벤트, 마지막 assistant 글, 사용률·요금제(`rate_limits`), 모델(`turn_context`) | 사용량 칸, 다른 곳에서 연 세션, 작업 모델 |
| `~/.codex/session_index.jsonl` | 세션 이름 | 다른 곳에서 연 세션 |
| `~/.codex/models_cache.json` | 목록 표시용 모델 이름 | 모델 선택 |

`~/.claude.json`에는 이메일·이름·계정 ID도 들어 있지만 읽어 온 뒤 버리며, 결과에 섞이지 않는 것을 테스트로 확인합니다(`src/main/account.test.ts`).

## 읽지 않는 정보

- `~/.codex/auth.json`(Codex 로그인 토큰)은 열지 않습니다
- `~/.claude/sessions/*.key` 파일은 열지 않습니다
- 로그인 토큰·API 키 값은 어디서도 읽지 않습니다. `ANTHROPIC_API_KEY`·`OPENAI_API_KEY`는 **설정돼 있는지만** 확인합니다

## 쓰는 정보

| 위치 | 내용 |
|---|---|
| `%APPDATA%\agent-desk\tasks.json` | 작업 목록(지시문, 담당 AI, 상태, 사용량, 작업 폴더 경로) |
| `%APPDATA%\agent-desk\logs\<작업ID>.jsonl` | AI 출력 원문. **코드와 대화 내용이 평문으로 저장됩니다** |
| `%APPDATA%\agent-desk\quota.json` | 마지막으로 받은 Claude 사용률 |
| `<저장소 상위>\.tm-worktrees\...` | 작업용 git worktree와 `tm/<작업ID>` 브랜치 |

앱을 지워도 위 파일은 남습니다. 필요하면 직접 지우세요.

## AI 실행 방식

- **실행 위치**: 작업마다 새 git worktree에서 실행합니다. 원래 저장소 폴더에는 직접 쓰지 않고, merge는 사용자가 합니다
- **Claude**: `claude -p --permission-mode acceptEdits`로 실행합니다. 파일 수정은 자동으로 허용되고, 그 밖의 도구 사용은 Claude Code의 권한 설정을 따릅니다(확인 창을 띄울 수 없는 모드라 허용되지 않은 도구는 거부됩니다)
- **Codex**: `codex exec -s workspace-write`(worktree에만 쓰기 가능한 샌드박스)로 실행합니다. 상의 모드의 의견 요청은 두 AI 모두 읽기 전용입니다
- **AI가 만든 결과는 반드시 검토한 뒤 합치세요.** 앱은 결과의 안전성을 보장하지 않습니다

## 명령 실행 안전장치

- 모든 외부 프로그램은 셸을 거치지 않고(`shell: false`) 인자 배열로 실행합니다. 지시문은 하나의 인자로만 전달되어 명령으로 해석되지 않습니다
- `-`로 시작하는 지시문은 앞에 공백을 붙여 CLI 옵션으로 해석되지 않게 합니다
- [직접 세션 열기]는 세션 ID를 영문·숫자·`-`로만 제한하고, git 저장소 폴더에서만 엽니다

## 앱 자체의 보호

- Electron `contextIsolation` 켬, `nodeIntegration` 끔. 화면에는 정해진 기능(`window.desk`)만 노출합니다
- Content-Security-Policy로 외부 스크립트·연결을 막습니다
- AI 출력에 섞인 링크로 새 창을 열거나 다른 페이지로 이동하지 않게 막습니다
- AI 출력은 React 텍스트로만 표시합니다(HTML로 해석하지 않음)
- 앱은 한 번에 하나만 실행됩니다(작업 기록 충돌 방지)
- 앱을 닫으면 실행 중인 AI 프로세스를 함께 종료합니다

## 요금 보호

[README의 "한도와 요금 보호"](README.md#한도와-요금-보호)를 보세요. 추가 요금이 생길 수 있는 상황에서는 앱이 진행하지 않고 공식 도구를 직접 열게 합니다.

## 설치 파일

- 설치 파일에는 코드 서명이 없습니다. Releases에 적힌 SHA-256 값과 내려받은 파일의 값이 같은지 확인한 뒤 실행하세요
- 설치 파일은 이 저장소의 코드로 `npm run dist`를 실행해 만든 것입니다. 직접 빌드해서 써도 됩니다

## 취약점 신고

공개 이슈로 올리지 말고, 이 저장소의 **Security** 탭 → **Report a vulnerability**로 비공개 신고해 주세요.
