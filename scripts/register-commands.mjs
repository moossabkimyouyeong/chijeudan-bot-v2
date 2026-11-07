const appId = "1568446216436584518";
const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
if (!token) throw new Error("GitHub Secret DISCORD_BOT_TOKEN is missing");
const str = (name, description, required = true) => ({type:3,name,description,required});
const user = (name="유저") => ({type:6,name,description:"대상 유저",required:true});
const integer = (name,description) => ({type:4,name,description,required:true});
const commands = [
{name:"ai",description:"Gemini AI에게 질문",options:[str("질문","AI에게 보낼 질문")]},
{name:"ai설정",description:"AI 채팅 설정 확인"},
{name:"대화초기화",description:"AI 대화 기록 초기화"},
{name:"토론",description:"AI 토론 시작 및 관리",options:[
{type:1,name:"시작",description:"AI 토론 시작",options:[str("주제","토론할 주제")]},
{type:1,name:"설정",description:"AI 토론 설정"},
{type:1,name:"종료",description:"진행 중인 AI 토론 종료"}]},
{name:"토론설정",description:"AI 토론 설정"},
{name:"토론종료",description:"AI 토론 종료"},
{name:"경고",description:"유저 경고",options:[user(),str("사유","경고 사유")]},
{name:"경고조회",description:"유저 경고 조회",options:[user()]},
{name:"추방",description:"유저 추방",options:[user(),str("사유","추방 사유",false)]},
{name:"차단",description:"유저 차단",options:[user(),str("사유","차단 사유",false)]},
{name:"청소",description:"메시지 일괄 삭제",options:[integer("개수","삭제할 메시지 수")]},
{name:"관리패널",description:"서버 관리 패널 열기"},
{name:"문의패널",description:"문의 티켓 패널 생성"},
{name:"문의설정",description:"문의 시스템 설정"},
{name:"투표",description:"투표 만들기",options:[str("질문","투표 질문"),str("선택지","쉼표로 구분한 선택지")]},
{name:"공지",description:"공지 작성",options:[str("내용","공지 내용")]},
{name:"임베드",description:"임베드 메시지 작성",options:[str("제목","임베드 제목"),str("내용","임베드 내용")]},
{name:"도움말",description:"봇 사용법 확인"}
];
const base = guildId
 ? `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`
 : `https://discord.com/api/v10/applications/${appId}/commands`;
const response = await fetch(base,{method:"PUT",headers:{"Authorization":`Bot ${token}`,"Content-Type":"application/json"},body:JSON.stringify(commands)});
const result=await response.json();
if (!response.ok) throw new Error(`Discord HTTP ${response.status}: ${JSON.stringify(result)}`);
console.log(`Registered ${result.length} slash commands (${guildId ? "guild" : "global"}).`);
