# 웹서비스 개발 래퍼 에이전트 설계서

> Gstack 위에 얹는 **"현장 감독" 에이전트**의 구현 계획서.
> 이 문서는 Claude Code에서 실제 구현 시 참조할 **계획서**이며, CLAUDE.md·SKILL.md의 **상세 내용은 포함하지 않는다** (구현 단계에서 작성).
>
> **이 설계서의 핵심 특징: 오류 복구 우선 설계 (Recovery-First Design).** 각 구성요소마다 실패 모드와 복구 방법을 명시한다.

---

## 1. 작업 컨텍스트

### 1.1 배경

Gstack(Garry Tan의 오픈소스 Claude Code 스킬 패키지)은 23개 스킬로 `Think → Plan → Build → Review → Test → Ship → Reflect` 전체 사이클을 커버한다. 하지만 **도구/유틸리티 웹앱을 빠르게 MVP까지 끌고 가는** 개인 개발자 맥락에서는 풀 사이클이 과잉이다.

### 1.2 목적

Gstack을 **"다 쓰는 것"이 아니라 "잘 고르는 것"**. 주요 분기점(새 기능 / 버그 / 배포)에서 현재 컨텍스트에 맞는 Gstack 스킬만 선별 호출한다.

### 1.3 범위

**포함:**
- 프로젝트 라이프사이클의 주요 분기점 감지
- 각 분기점에서 호출할 Gstack 스킬 조합 판단
- MVP 범위 스코프 가드 (기능 팽창 방지)
- 최소한의 프로젝트 상태 추적
- **오류 발생 시 자가 진단·복구 메커니즘**

**제외:**
- Gstack 스킬 자체의 내부 로직 수정
- 팀 협업 워크플로우
- 코드 직접 생성 로직

### 1.4 입출력

| 구분 | 내용 |
|------|------|
| **입력** | 자연어 사용자 의도, 프로젝트 현재 상태 (파일 시스템, git) |
| **출력** | 호출할 Gstack 스킬 시퀀스 + 실행, 스코프 가드 경고, 상태 로그 |

### 1.5 제약조건

- 오버엔지니어링 금지 (기본값은 항상 "가볍게")
- Gstack 스킬은 수정하지 않음 (외부 의존성)
- 사용자 호출 중심, 주요 분기점에서만 개입
- 개인 프로젝트 전용
- **래퍼가 고장나도 Gstack 본체는 정상 작동해야 함** (래퍼는 선택적 레이어)

### 1.6 용어

| 용어 | 정의 |
|------|------|
| **Gstack** | Garry Tan의 Claude Code 스킬 패키지 (외부 의존성) |
| **래퍼 에이전트** | 본 설계 대상 |
| **분기점** | 래퍼가 개입하는 시점 (새 기능 / 버그 / 배포) |
| **MVP 가드** | 기능이 MVP 범위 내인지 판단하는 체크 |
| **상태 파일** | `.wrapper-state.json`. 래퍼의 모든 판단 근거 |
| **진단 스킬** | 래퍼 자체 상태를 점검하는 메타 스킬 (`doctor`) |

---

## 2. 워크플로우 정의

### 2.1 전체 흐름

```
[사용자 발화]
      │
      ▼
[0] 헬스체크 (선택적, 가벼움)   ← 상태 파일 존재/스키마 확인
      │
      ├─ 이상 감지 → doctor 스킬 호출 권고 후 진행
      │
      ▼
[1] 의도 분류   ← LLM 판단
      │
      ├─ 분기점 아님    → 비개입, Claude Code 본체로 위임
      ├─ 프로젝트 시작  → 최소 스캐폴딩 가이드 (스킵 가능)
      ├─ 새 기능        → 2.2 플로우
      ├─ 버그           → 2.3 플로우
      ├─ 배포           → 2.4 플로우
      └─ 메타 요청      → 2.5 플로우 (상태 조회·복구·래퍼 무력화 등)
```

### 2.2 신규 기능 플로우

```
"X 기능 추가할게"
   │
   ▼
[A] MVP 스코프 가드  ← LLM 판단
   ├─ 핵심 → [B]
   ├─ 확장 → "미룰까?" 확인
   └─ 불명확 → AskUser
   │
   ▼
[B] 복잡도 판단  ← LLM 판단
   ├─ 단순 → /review만
   ├─ 중간 → /autoplan
   └─ 복잡/불확실 → /office-hours
   │
   ▼
[C] 구현 (Claude Code 본체)
   │
   ▼
[D] 검증  ← LLM 판단
   ├─ UI 포함 → /qa + /review
   ├─ 로직만 → /review
   └─ 사소 → 스킵
   │
   ▼
[E] 상태 로그 (스크립트)
```

### 2.3 버그 플로우

```
"버그 있어" 또는 에러 보고
   │
   ▼
[A] 심각도/재현성 판단  ← LLM
   ├─ 재현 불가/원인 불명 → /investigate
   ├─ 재현 가능, 원인 명확 → 바로 수정
   └─ UI 관련 → /qa로 재현부터
   │
   ▼
[B] 수정 (Claude Code 본체)
   │
   ▼
[C] /review (건너뛰지 않음)
   │
   ▼
[D] 상태 로그
```

### 2.4 배포 플로우

```
"배포할게"
   │
   ▼
[A] 배포 전 체크  ← 상태 파일 + LLM
   ├─ 최근 /review 없음 → /review 선행
   ├─ UI 변경 & /qa 없음 → /qa 선행
   └─ 통과 → [B]
   │
   ▼
[B] /ship
   │
   ▼
[C] /canary 권고 (선택)
```

### 2.5 메타 요청 플로우 (신설 — 복구·진단 진입점)

```
"상태 보여줘" / "왜 이 스킬이 돌았지" / "래퍼 꺼줘" / "뭔가 이상해"
   │
   ▼
[A] 메타 의도 분류  ← LLM
   ├─ 상태 조회       → state view (상태 파일 포맷팅 출력)
   ├─ 판단 근거 조회  → routing log 조회 (최근 N건)
   ├─ 진단 요청       → doctor 스킬 호출
   ├─ 복구 요청       → doctor --repair
   ├─ 일시 무력화     → bypass 모드 활성화 (다음 세션까지 래퍼 비개입)
   └─ 영구 무력화     → 비활성화 가이드 출력
```

### 2.6 LLM 판단 vs 코드 처리

| LLM 판단 | 스크립트 |
|----------|---------|
| 의도 분류 | 상태 파일 I/O |
| MVP 스코프 가드 | git 상태 조회 |
| 복잡도 판단 | 최근 스킬 실행 기록 읽기 |
| 버그 심각도 | 상태 파일 스키마 검증 |
| 스킬 조합 결정 | 스택 감지 |
| 질문 시점 결정 | Gstack 설치 여부 확인 |

### 2.7 단계별 성공 기준·검증·실패 처리

| 단계 | 성공 기준 | 검증 방법 | 실패 시 처리 |
|------|----------|----------|-------------|
| 헬스체크 | 상태 파일 읽기 가능 + 스키마 유효 | 스키마 검증 (스크립트) | **자동 복구 시도 → 실패 시 백업에서 복원 → 그래도 실패 시 초기화 권고** |
| 의도 분류 | 분기점 3종 중 하나 또는 "비개입" | LLM 자기 검증 | 불명확 → **에스컬레이션** (AskUser) |
| MVP 스코프 가드 | 핵심/확장/불명확 중 하나 | 규칙 기반 + LLM | 불명확 → **에스컬레이션** |
| 복잡도 판단 | Gstack 스킬 조합 결정 | LLM 자기 검증 (근거 로그) | **폴백**: `/autoplan` 기본값 |
| 스킬 실행 | Gstack 스킬 정상 종료 | exit code | **로그 기록 + 사용자 통지**. 재시도 안 함 (Gstack 영역). **해당 스킬이 Gstack에 없으면** → suggested alternatives 출력 |
| 상태 로그 업데이트 | 상태 파일에 기록됨 | 스키마 검증 + 쓰기 확인 | 쓰기 실패 → **임시 로그로 폴백 기록 + 경고**. 다음 성공 시 merge |
| 배포 전 체크 | 체크리스트 통과 또는 명시적 override | 규칙 기반 | 미통과 → **선행 스킬 자동 권고** |

---

## 3. 구현 스펙

### 3.1 폴더 구조

```
/<프로젝트-루트>
  ├── CLAUDE.md
  ├── /.claude
  │   ├── /skills
  │   │   ├── /route-gstack
  │   │   │   ├── SKILL.md
  │   │   │   ├── /scripts
  │   │   │   │   ├── detect-stack.sh
  │   │   │   │   ├── read-state.sh
  │   │   │   │   ├── update-state.sh
  │   │   │   │   └── check-gstack-available.sh   # Gstack 설치·스킬 존재 확인
  │   │   │   └── /references
  │   │   │       ├── gstack-skill-map.md
  │   │   │       ├── routing-rules.md
  │   │   │       └── error-codes.md               # 래퍼 자체 에러 코드 카탈로그
  │   │   │
  │   │   ├── /mvp-scope-guard
  │   │   │   ├── SKILL.md
  │   │   │   ├── /scripts
  │   │   │   │   └── check-core-features.sh
  │   │   │   └── /references
  │   │   │       └── scope-patterns.md
  │   │   │
  │   │   ├── /project-state
  │   │   │   ├── SKILL.md
  │   │   │   └── /scripts
  │   │   │       ├── init-state.sh
  │   │   │       ├── log-skill-run.sh
  │   │   │       ├── validate-state.sh             # 스키마 검증
  │   │   │       ├── backup-state.sh               # 쓰기 전 자동 백업
  │   │   │       └── restore-state.sh              # 백업에서 복원
  │   │   │
  │   │   ├── /doctor                               # ★ 신설: 진단·복구 스킬
  │   │   │   ├── SKILL.md
  │   │   │   ├── /scripts
  │   │   │   │   ├── doctor.sh                     # 전체 헬스체크
  │   │   │   │   ├── repair.sh                     # 자동 복구 시도
  │   │   │   │   └── reset.sh                      # 완전 초기화 (확인 후)
  │   │   │   └── /references
  │   │   │       ├── diagnostic-checklist.md       # 진단 항목 리스트
  │   │   │       └── recovery-playbook.md          # 증상별 복구 절차
  │   │   │
  │   │   └── /bootstrap-util                       # (선택)
  │   │       ├── SKILL.md
  │   │       └── /references
  │   │           └── stack-presets.md
  │   │
  │   └── (서브에이전트 없음)
  │
  ├── /output
  │   ├── .wrapper-state.json                       # 현재 상태
  │   ├── .wrapper-state.backup.json                # 직전 백업 (자동)
  │   ├── .wrapper-state.initial.json               # 초기화 시점 백업
  │   ├── routing-log.jsonl                         # 라우팅 결정 로그
  │   ├── skill-runs.jsonl                          # 스킬 실행 이력
  │   ├── scope-decisions.md                        # 스코프 판정 이력
  │   └── error-log.jsonl                           # 에러·복구 이력 ★ 신설
  │
  └── /docs (선택)
```

### 3.2 CLAUDE.md 핵심 섹션

1. 에이전트 정체성
2. Gstack 스킬 목록 선언
3. 개입 규칙 (분기점 정의)
4. 기본 철학 (도구/유틸 + 빠른 MVP)
5. 스킬 호출 순서
6. 사용자 명시적 override 규칙
7. 상태 파일 규약
8. 경고 사례
9. **★ 에러 대응 규약** — 래퍼 자체 오류 발생 시 행동 규칙 (아래 3.9 참조)
10. **★ Bypass 모드** — 래퍼를 일시 무력화하는 사용자 명령 처리

### 3.3 에이전트 구조

**단일 에이전트 + 5개 스킬** (doctor 추가됨).

근거:
- 파이프라인 단순, 서브에이전트 이점 적음
- MVP 컨텍스트 부합
- **진단·복구를 별도 스킬(doctor)로 분리**하여 다른 스킬이 고장나도 doctor는 독립 동작하도록

### 3.4 처리 방식

| 단계 | 처리 |
|------|------|
| 의도 분류 | 에이전트 판단 |
| 헬스체크 | 스크립트 (`validate-state.sh`) |
| 상태 읽기/쓰기 | 스크립트 (쓰기 전 자동 백업) |
| 스택 감지 | 스크립트 |
| MVP 가드 | 에이전트 + 선택적 스크립트 |
| 복잡도 판단 | 에이전트 |
| Gstack 호출 결정 | 에이전트 + references |
| Gstack 가용성 체크 | 스크립트 (`check-gstack-available.sh`) |
| 상태 로그 | 스크립트 |
| 진단 | 스크립트 (`doctor.sh`) — LLM은 결과 해석만 |
| 복구 | 스크립트 (`repair.sh`) — 단계별, 각 단계 사용자 확인 |

### 3.5 스킬 목록

| 스킬 | 역할 | 트리거 |
|------|------|--------|
| **route-gstack** | 라우팅 결정 | 분기점 감지 시 |
| **mvp-scope-guard** | MVP 범위 가드 | 새 기능 분기 시 (내부 체크) |
| **project-state** | 상태 파일 관리 | 모든 스킬 호출 전후 |
| **doctor** | 진단·복구 | ① 헬스체크 실패 시 ② 사용자가 "뭔가 이상해" 류 발화 시 ③ 수동 호출 |
| **bootstrap-util** (선택) | 스택 프리셋 | 프로젝트 초기 |

**실행 우선순위:**
1. `project-state` — 상태 적재 (실패 시 `doctor` 자동 호출)
2. `route-gstack` — 라우팅 결정
3. 필요 시 `mvp-scope-guard` / `bootstrap-util`
4. Gstack 스킬 실행
5. `project-state` — 이력 기록

### 3.6 산출물

| 산출물 | 경로 | 형식 | 용도 |
|--------|------|------|------|
| 현재 상태 | `/output/.wrapper-state.json` | JSON | 단일 진실 소스 |
| 직전 백업 | `/output/.wrapper-state.backup.json` | JSON | **자동 복구 1차 소스** |
| 초기 백업 | `/output/.wrapper-state.initial.json` | JSON | **완전 복구 최종 소스** |
| 라우팅 로그 | `/output/routing-log.jsonl` | JSONL | **왜 그 판단을 했는지 추적** |
| 스킬 실행 이력 | `/output/skill-runs.jsonl` | JSONL | 실행 기록 |
| 스코프 판정 | `/output/scope-decisions.md` | Markdown | 사용자 가독 이력 |
| 에러·복구 이력 | `/output/error-log.jsonl` | JSONL | **장애 디버깅 핵심** |

### 3.7 데이터 전달

- 상태 → 판단: 파일 기반
- 결정 → Gstack: 프롬프트 인라인 (슬래시 커맨드)
- 실행 결과 → 상태: 파일 기반 (append)
- **모든 쓰기는 백업 → 검증 → 커밋 3단계**로 처리

### 3.8 상태 파일 스키마 (핵심 원칙만)

구현 시 세부 스키마를 작성하되, 다음을 원칙으로 한다:

- **버전 필드 필수** (`schema_version`) — 스키마 변경 시 마이그레이션 판단용
- **모든 엔트리에 timestamp** — 시간 순 재구성 가능
- **필수 필드 최소화** — 누락 시에도 부분 복구 가능하도록
- **자가 설명적 구조** — 사람이 파일을 직접 열어도 의미 파악 가능
- **idempotent 쓰기 지향** — 같은 작업을 재실행해도 일관성 유지

### 3.9 ★ 에러 대응 규약 (핵심 섹션)

모든 스킬과 스크립트는 다음 원칙을 따른다:

#### (1) 에러 코드 체계

래퍼 자체 에러에 고정 코드를 부여한다 (예시):

| 코드 | 의미 | 기본 대응 |
|------|------|----------|
| `W001` | 상태 파일 없음 | 초기화 제안 |
| `W002` | 상태 파일 스키마 불일치 | 백업에서 복원 시도 |
| `W003` | 상태 파일 JSON 파싱 실패 | 백업에서 복원 시도 |
| `W004` | Gstack 미설치 | 설치 가이드 안내 |
| `W005` | Gstack 스킬 존재하지 않음 (기대 스킬 누락) | 대체 스킬 제안 |
| `W006` | 쓰기 권한 없음 | 권한 체크 안내 |
| `W007` | 백업 파일도 손상 | 초기 백업에서 복원 시도 |
| `W008` | 모든 복구 실패 | 수동 초기화 가이드 |
| `W999` | 분류 불가 에러 | 원본 에러 메시지 노출 + 로그 덤프 |

에러 코드 카탈로그는 `error-codes.md`에 구현 단계에서 작성.

#### (2) 에러 메시지 형식

사용자에게 노출되는 모든 에러 메시지는 다음을 포함한다:

- 에러 코드 (예: `W002`)
- 무엇이 잘못됐는지 (1-2줄)
- 지금 당장 할 수 있는 다음 행동 (명령어 또는 스킬 이름)
- 로그 위치 (더 자세히 보려면)

#### (3) 복구 3단계 원칙

어떤 오류든 복구는 다음 3단계로 시도한다:

1. **자동 복구** — 백업 파일 존재 시 조용히 복원 (사용자에게 알림만)
2. **유도 복구** — `doctor --repair` 호출 제안, 사용자 승인 후 실행
3. **수동 초기화** — 자동·유도 복구 모두 실패 시, 초기화 명령과 복구 불가 데이터 안내

#### (4) 로깅 의무

- 모든 에러는 `error-log.jsonl`에 timestamp·에러코드·컨텍스트·복구결과 기록
- 자동 복구 성공도 로그 남김 (나중에 패턴 분석용)

#### (5) 래퍼 고장 시 Gstack 보호

래퍼 스킬이 어떻게 고장나든, **Gstack 본체는 직접 호출 가능해야 한다**. 사용자가 `/review` 등을 직접 치면 동작해야 함. 래퍼는 Gstack 스킬을 가로채지 않고 "추천"만 한다.

### 3.10 ★ Bypass 모드

사용자가 "래퍼 꺼줘", "일단 직접 할게" 등 발화 시:

- 해당 세션 내에서 래퍼 스킬이 비개입 모드로 전환
- 상태 파일에 `bypass_until_session_end: true` 플래그
- 다음 세션 시작 시 자동 해제
- **영구 비활성화**를 원하면 CLAUDE.md에서 래퍼 섹션 제거하는 방법 안내

---

## 4. 설계 결정 요약

| 결정 | 근거 |
|------|------|
| 단일 에이전트 | 파이프라인 단순, 복잡도 비용 회피 |
| Gstack 무수정 | 업데이트 충돌 방지 |
| 3개 분기점만 개입 | 사용자 요구 반영 |
| MVP 가드 독립 스킬 | 가장 흔한 실패 모드 대응 |
| 상태 파일 JSON | 파싱·추적·가독성 |
| bootstrap-util 선택 | 우선순위 낮음 |
| `/autoplan` 중간 복잡도 기본값 | Gstack 내부 라우팅 활용 |
| **doctor 스킬 분리** | **다른 스킬 고장 시에도 독립 동작** |
| **3중 백업 (current·backup·initial)** | **다단계 복구 경로 확보** |
| **에러 코드 체계 도입** | **디버깅 용이성·재현성** |
| **Bypass 모드** | **래퍼 고장 시 탈출 경로** |

---

## 5. 구현 권장 순서

1. **최소 골격**: CLAUDE.md + `project-state` (검증·백업 포함) + `doctor` 뼈대
2. **에러 인프라 선행**: 에러 코드 카탈로그·로깅 규약
3. **라우팅 코어**: `route-gstack` + references
4. **스코프 가드**: `mvp-scope-guard`
5. **부트스트랩 추가** (선택)
6. **실사용 로그 기반 튜닝**

**중요**: `doctor`를 다른 스킬보다 먼저 뼈대만이라도 구현하면, 이후 개발 중 문제가 생겨도 자가 진단 가능.

---

## 6. 열린 질문 → 인터뷰로 확정 (§8 참조)

§6의 모든 열린 질문은 인터뷰를 통해 §8에서 확정되었다. 원문 보존:

- ~~MVP 범위 정의 방식~~ → 매번 LLM 판단 + 과거 판정 참조 (§8.2)
- ~~Gstack 버전 pinning 정책~~ → pinning 없음, 가용성 체크만 (§8.10)
- ~~`/learn` 스킬 연동 시점~~ → /learn이 wrapper 로그 참조 (§8.10)
- ~~배포 플랫폼 기본값~~ → Vercel (Next.js + Vercel + Supabase 프리셋, §8.10)
- ~~상태 파일 백업 보존 주기~~ → N개 로테이션 (§8.5)
- ~~에러 로그 보존 주기~~ → 30일 후 archive/ (§8.9)

---

## 7. 문제 발생 시 참고 (사용자 셀프 체크리스트)

> 실제 래퍼 사용 중 이상 증상이 있을 때 확인할 항목. 구현 후 `recovery-playbook.md`에 확장될 내용의 초안.

| 증상 | 1차 확인 | 2차 대응 |
|------|---------|---------|
| 래퍼가 엉뚱한 Gstack 스킬 호출 | `routing-log.jsonl` 최신 엔트리 — 판단 근거 확인 | `routing-rules.md` 수정 |
| 상태가 이상하게 보임 | `.wrapper-state.json` 직접 열어보기 | `doctor` 호출 |
| 래퍼가 아예 응답 안 함 | Gstack 직접 호출 테스트 (`/review` 등) | Gstack 정상이면 래퍼 문제 → `doctor` |
| 같은 경고가 반복됨 | `scope-decisions.md` 확인 — 패턴 파악 | 해당 기능을 MVP 리스트에 추가 |
| Gstack 업데이트 후 깨짐 | `check-gstack-available.sh` 실행 | 기대 스킬 목록을 `gstack-skill-map.md`에서 갱신 |
| 뭔가 이상한데 뭔지 모름 | `doctor` 호출 | `doctor --repair` |
| 복구도 안 됨 | `error-log.jsonl` 최근 엔트리 확인 | 수동 초기화 — 초기 백업에서 복원 |
| 래퍼가 너무 귀찮음 | "래퍼 꺼줘" 발화 → Bypass 모드 | CLAUDE.md에서 섹션 제거 (영구) |

---

## 8. 인터뷰 기반 확정 결정

> 본 절은 §1-§7 설계 초안을 기반으로 사용자 인터뷰를 통해 확정된 구현 결정을 모은다. 충돌 시 §8이 우선한다.

### 8.1 UX 표면 — Pre-announce + 자동 진행

| 항목 | 결정 |
|------|------|
| 표면화 방식 | Pre-announce 후 즉시 실행 (중단·confirm 없음) |
| 출력 포맷 | 1줄 최소형, 색상·이모지 없음 |
| 출력 prefix | `[wrapper]` (단일 토큰으로 grep 가능) |
| 예시 | `[wrapper] route→/autoplan  reason: mid-complexity, MVP-core` |

**근거:** 흐름 방해 최소 + 투명성 확보. `[wrapper]` prefix로 사용자가 wrapper 출력을 시각적으로 즉시 분리 가능.

### 8.2 분기점·라우팅

#### (1) 분기점 4종

| 분기점 | 트리거 | 기본 라우팅 |
|--------|--------|------------|
| 새 기능 | 키워드 + LLM | §2.2 플로우 |
| 버그 | 키워드 + LLM | §2.3 플로우 |
| 배포 | 키워드 + LLM | §2.4 플로우 |
| **유지보수 (신설)** | 리팩터링·성능·의존성·문서 키워드 | **규모별 분기 (8.2-(2))** |

#### (2) 유지보수 분기점의 규모별 라우팅

규모는 **영향 파일 수**로 판단 (`git status` + LLM 추정).

| 규모 | 파일 수 | Gstack 시퀀스 |
|------|---------|--------------|
| 소 | 1-3 | `/review` |
| 중 | 4-10 | `/autoplan` → `/review` |
| 대 | 11+ | `/office-hours` |

문서 작성·README 갱신은 규모와 무관하게 비개입 (Claude Code 본체).

#### (3) MVP 스코프 가드

- **판단 방식:** 매번 LLM이 컨텍스트 기반으로 판단 (사전 feature list 없음)
- **일관성 보정:** `scope-decisions.md`의 과거 판정을 LLM 컨텍스트에 첨부
- **압축 전략:** 기능별 요약 형식 — `feature: 'auth' → 핵심(7회)/확장(2회)`. 세부 판정 이유는 동일 기능 재질의 시에만 조회

### 8.3 의도 분류 — 키워드 프리필터 + LLM

#### (1) 2단계 분류

```
사용자 발화
  ↓
[1] 키워드 프리필터 (스크립트, 비용 0)
  ├─ 매치 없음 → wrapper 비개입 (LLM 호출 안 함)
  └─ 매치 있음 → [2]
  ↓
[2] LLM 의도 분류 → 분기점 결정
```

#### (2) 트리거 키워드 (좋은 고정 리스트, ~30개)

`references/trigger-keywords.md`에 카테고리별 정리. 초기 셋 예시:

| 카테고리 | 키워드 |
|---------|--------|
| 새 기능 | 추가, 구현, 만들, 넣, 새로, 기능, feature, add, implement |
| 버그 | 버그, 에러, 안 됨, 안돼, 깨짐, 고치, 수정, bug, error, fix, broken |
| 배포 | 배포, 릴리즈, ship, deploy, release, publish |
| 유지보수 | 리팩터, 정리, 성능, 느림, 의존성, 업데이트, 문서, refactor, optimize, slow, deps, docs |

키워드 누락 시에도 사용자가 직접 `/wrap-feature` 등 슬래시 명령으로 강제 진입 가능.

### 8.4 재사용 — 글로벌 설치 + 프로젝트별 상태

| 구성요소 | 위치 |
|---------|------|
| Wrapper 스킬 본체 (CLAUDE.md, SKILL.md, scripts, references) | `~/.claude/skills/<wrapper-skills>/` |
| 프로젝트별 상태·로그 | `~/.claude/wrapper-state/<project-hash>/` |
| project-hash 산출 | 프로젝트 절대 경로의 SHA-1 앞 12자 |

**저장소 구조 (개정):**

```
~/.claude/wrapper-state/<hash>/
  ├── state.json
  ├── state.<timestamp>.json   # N=5 로테이션
  ├── routing-log.jsonl
  ├── skill-runs.jsonl
  ├── scope-decisions.md
  ├── error-log.jsonl
  ├── project-meta.json        # 원본 경로·이름·생성일 (경로 변경 추적용)
  └── archive/
      └── <30일+ 로그>
```

**git 추적 안 함** — 모든 wrapper 산출물은 사용자 홈 디렉터리. 프로젝트 저장소 오염 없음.

§3.1의 `/output/.wrapper-state.json` 등 프로젝트 내 경로는 **§8로 대체된다**.

### 8.5 백업 전략 — Backup + N개 로테이션

- 3중 백업(current·backup·initial) 폐기
- `state.json` (current) + 마지막 5개 `state.<timestamp>.json` 유지
- 6번째 쓰기 시 가장 오래된 백업 삭제
- 복구 시 timestamp 역순으로 시도

### 8.6 에러 처리 — 카테고리만 유지

§3.9 (1)의 W001-W999 폐기. 4개 카테고리로 단순화:

| 카테고리 | 의미 | 기본 대응 |
|---------|------|----------|
| `state` | 상태 파일 손상·누락·스키마 불일치 | 자동 복구 시도 → 실패 시 doctor |
| `gstack` | Gstack 미설치·기대 스킬 누락·실행 실패 | 대체 스킬 제안 (8.7) |
| `permission` | 쓰기·실행 권한 없음 | 권한 체크 안내 |
| `unknown` | 분류 불가 | 원본 에러 + 로그 위치 노출 |

에러 메시지 형식 (§3.9 (2))은 유지하되, 코드 대신 카테고리 명시:
```
[wrapper:state] state.json JSON 파싱 실패
다음: doctor 자동 실행 중...
로그: ~/.claude/wrapper-state/<hash>/error-log.jsonl
```

### 8.7 Gstack 스킬 실패 — Fallback Chain

`routing-rules.md`에 fallback 체인 명시:

```yaml
fallback:
  /office-hours: [/autoplan, /review]
  /autoplan: [/review]
  /investigate: [/review]
```

스킬 실패 시 사용자에게 1줄 제안 후 confirm:
```
[wrapper:gstack] /office-hours 실패. /autoplan으로 fallback할까요? (y/n)
```

자동 재시도는 하지 않음.

### 8.8 doctor 자동 트리거

| 조건 | 동작 |
|------|------|
| state 파일 JSON 파싱 실패 | doctor 자동 실행 (사용자 알림만) |
| state 스키마 불일치 | doctor 자동 실행 |
| 그 외 모든 에러 | 로그 기록만, 자동 실행 없음 |
| 사용자 명시 호출 | 항상 실행 |

근거: 자동 트리거 범위를 좁혀 doctor 자체가 추가 노이즈 원인이 되는 것 방지.

### 8.9 로그 보존 — 30일 archive

| 로그 | 보존 |
|------|------|
| 활성 로그 | 최근 30일분 root에 유지 |
| 30일+ | `archive/<YYYY-MM>.jsonl.gz`로 압축 이동 |
| 압축 | gzip (텍스트 압축률 충분) |
| LLM 컨텍스트 | 활성 로그에서만 읽기, archive는 명시 요청 시에만 |

`project-state` 스킬에 일일 1회 archive 작업 포함 (헬스체크 시 트리거).

### 8.10 Gstack 의존성 관리

#### (1) 버전 정책

- pinning 없음 (Gstack을 그대로 따라감)
- `check-gstack-available.sh`가 매 세션 시작 시 `gstack-skill-map.md`의 기대 스킬 목록과 실제 비교
- 누락된 스킬 발견 시 1회 경고 + routing-rules.md에서 해당 스킬 임시 비활성화

#### (2) /learn 연동

- Gstack `/learn` 호출 시 wrapper의 `routing-log.jsonl`·`scope-decisions.md`도 입력으로 전달
- wrapper가 별도 학습 루프를 운영하지 않음 (책임 통합)
- 통합 방식: wrapper가 `/learn` 호출을 가로채 추가 컨텍스트를 프롬프트에 inline

### 8.11 Override 적응 — 제안만

| 신호 | 카운팅 |
|------|--------|
| 사용자가 wrapper 추천 직후 다른 스킬로 교체 | override count +1 |
| 사용자가 pre-announce 직후 즉시 ctrl+c·중단 발화 | override count +1 |
| 사용자가 결과에 대해 부정적 명시 피드백 | override count +1 |

3회 누적 시 1회 제안:
```
[wrapper] 최근 비슷한 케이스에서 3회 다른 스킬로 교체하셨어요.
routing-rules.md에 다음 패턴을 추가할까요? <패턴 요약>
```

수정은 사용자가 직접. wrapper 자동 수정 안 함.

### 8.12 Bypass 모드

| 트리거 | 처리 |
|--------|------|
| `/wrapper-off` 슬래시 | 즉시 bypass, 확인 없음 |
| "래퍼 꺼줘" / "직접 할게" 등 명확한 자연어 | 즉시 bypass |
| 애매한 자연어 ("좀 시끄러워", "그만") | confirm 1회 |

bypass 상태는 `state.json`에 `bypass_until_session_end: true` 플래그. 다음 세션 자동 해제.

### 8.13 직접 Gstack 호출 처리

사용자가 wrapper 우회하여 `/review` 등 직접 호출 시:

- wrapper는 **개입 없음** (intercept 안 함)
- `skill-runs.jsonl`에 `source: "direct"`로 조용히 기록
- state 정확성 유지 (다음 라우팅 판단의 근거가 됨)

### 8.14 온보딩 — 1회성 원샷

첫 분기점 발화 시 (state.json 미존재 시점):

1. `init-state.sh` 자동 실행 (조용히)
2. 1회 노출 메시지:
   ```
   [wrapper] 활성화됨. 끄려면 /wrapper-off, 진단은 doctor.
   ```
3. 이후 정상 라우팅 진행

별도 `/wrapper-init` 명령 없음. 사용자가 명시 셋업할 필요 없음.

### 8.15 Plan mode 통합

Claude Code가 plan mode일 때:

- wrapper는 **실행하지 않음**
- 대신 plan에 라우팅 제안 한 줄 포함:
  ```
  - [wrapper 제안] 이 단계에서 보통 /autoplan 호출
  ```
- ExitPlanMode 후 사용자가 진행 시 정상 라우팅

근거: Plan mode의 "실행 안 함" 계약과 wrapper의 자동 실행 충돌 방지.

### 8.16 메타 질의 — "왜 이 스킬이 돌았지"

별개 세션에서 사용자가 과거 라우팅 사유 질문 시:

1. `routing-log.jsonl` grep으로 해당 엔트리 찾기
2. 당시 컨텍스트 (skill-runs, state 스냅샷) + 로그 엔트리를 LLM 컨텍스트로 재구성
3. 자연어 설명:
   ```
   화요일 14:32에 /autoplan 호출했어요.
   당시 'auth UI 추가' 발화 → 새 기능 분기, 중간 복잡도(영향 파일 5개), MVP-핵심 판정.
   상세: routing-log.jsonl line 142
   ```

`/wrap-why` 명령은 두지 않음. 자연어 질문으로 충분.

### 8.17 bootstrap-util 스택 프리셋 (우선순위)

P1만 우선 구현, 나머지는 나중:

| 우선순위 | 스택 |
|---------|------|
| **P1** | **Next.js + Vercel + Supabase** |
| P2 | (인터뷰에서 미선택, 추후 사용 패턴 보고 추가) |

`stack-presets.md`에 P1 프리셋만 정의:
- `package.json` 시드, `vercel.json`, Supabase 클라이언트 setup, 기본 디렉터리 구조

---

## 9. 인터뷰 결정에 따른 §3 개정 사항 (요약)

| §3 원안 | 개정 |
|---------|------|
| `/output/.wrapper-state.json` | `~/.claude/wrapper-state/<hash>/state.json` (§8.4) |
| 3중 백업 (current·backup·initial) | N=5 로테이션 (§8.5) |
| W001-W999 에러 코드 | 4 카테고리 (§8.6) |
| `bootstrap-util` (선택) | P1 = Next.js+Vercel+Supabase 우선 구현 (§8.17) |
| 모든 발화 라우팅 | 키워드 프리필터 + LLM (§8.3) |
| 헬스체크 실패 시 doctor | state 파일 손상에만 자동 (§8.8) |

---

*설계서 끝*
