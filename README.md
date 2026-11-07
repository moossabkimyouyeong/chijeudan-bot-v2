# 취즈단봇v2

Cloudflare Workers 기반 Discord 봇 프로젝트.

현재 구현: Discord Ed25519 서명 검증, PING, /도움말 응답 핸들러.

## 배포
Cloudflare Workers에서 GitHub 저장소를 연결하고 배포한다.
Worker secret `DISCORD_PUBLIC_KEY`에 Discord Developer Portal의 Public Key를 설정한다.
Discord Interactions Endpoint URL: `https://<worker-address>/discord`.

주의: /도움말은 별도 Discord Application Command 등록이 필요하다. 나머지 기능과 D1/Gemini 연동은 추후 구현한다. 비밀 키를 GitHub에 커밋하지 않는다.


<!-- Trigger production deployment after configuring GEMINI_API_KEY in Vercel. -->
