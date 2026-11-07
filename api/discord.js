import { createPublicKey, verify as verifySignature } from "node:crypto";
import { waitUntil } from "@vercel/functions";

const APP_ID = "1568446216436584518";
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const reply = (res, data) => res.status(200).json(data);
const message = (content, ephemeral = false) => ({ type: 4, data: { content, ...(ephemeral ? { flags: 64 } : {}) } });
const option = (i, key) => i.data?.options?.find(o => o.name === key)?.value;
const debateButtons = (disabled = false) => [{ type: 1, components: [
  { type: 2, style: 1, label: "다음 라운드", custom_id: "debate:next", disabled },
  { type: 2, style: 4, label: "토론 종료", custom_id: "debate:end", disabled }
]}];
const clip = (s, n = 1800) => String(s || "").slice(0, n);
async function gemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Vercel 환경변수 GEMINI_API_KEY가 필요해요.");
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 900 } }),
    signal: AbortSignal.timeout(45000)
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || `Gemini HTTP ${r.status}`);
  return clip(j.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "답변을 생성하지 못했어요.");
}
async function updateOriginal(i, payload) {
  const url = `https://discord.com/api/v10/webhooks/${i.application_id || APP_ID}/${i.token}/messages/@original`;
  const r = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!r.ok) console.error("Discord followup failed:", r.status, (await r.text()).slice(0, 300));
}
function background(i, work) {
  waitUntil((async () => {
    try { await updateOriginal(i, await work()); }
    catch (e) { console.error("AI error", e); await updateOriginal(i, { content: "오류: " + clip(e.message, 300), components: [] }); }
  })());
}
function debateTopic(i) {
  const title = i.message?.embeds?.[0]?.title || "";
  return title.startsWith("🧀 AI 토론: ") ? title.slice("🧀 AI 토론: ".length) : null;
}
async function debateRound(topic, round) {
  const prompt = `당신은 한국어 토론 진행자입니다. 주제: "${topic}". ${round}라운드를 진행하세요. 찬성 AI와 반대 AI가 서로 상대 주장을 직접 반박하도록 하세요. 각 AI 발언 2~3문장, 전체 1200자 이내. 형식: "🟦 찬성 AI: ..." 다음 "🟥 반대 AI: ...". 현실적이고 자연스럽게 토론하세요.`;
  return gemini(prompt);
}

const PERMS = { KICK: 2n, BAN: 4n, MANAGE_MESSAGES: 8192n, MODERATE: 1099511627776n };
function allowed(i, perm) { return (BigInt(i.member?.permissions || "0") & perm) === perm; }
async function discordApi(path, method = "GET", body) {
  if (!process.env.DISCORD_BOT_TOKEN) throw new Error("Vercel에 DISCORD_BOT_TOKEN을 설정해야 해요.");
  const r = await fetch("https://discord.com/api/v10" + path, {
    method,
    headers: { Authorization: "Bot " + process.env.DISCORD_BOT_TOKEN, "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(12000)
  });
  const txt = await r.text();
  const data = txt ? (() => { try { return JSON.parse(txt); } catch { return txt; } })() : null;
  if (!r.ok) throw new Error("Discord API " + r.status + ": " + clip(data?.message || txt, 160));
  return data;
}

async function ticketConfig(guildId, channels) {
  const list = channels || await discordApi(`/guilds/${guildId}/channels`);
  const store = list.find(c => c.type === 0 && c.name === "chiju-ticket-config" && c.topic?.startsWith("CHIJU_CONFIG:"));
  let config = {};
  if (store) { try { config = JSON.parse(store.topic.slice(13)); } catch {} }
  return { list, store, config };
}

function safeReason(s) { return clip(String(s || "사유 없음").replace(/[@`]/g, ""), 350); }

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  const signature = req.headers["x-signature-ed25519"];
  const timestamp = req.headers["x-signature-timestamp"];
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (typeof signature !== "string" || typeof timestamp !== "string" || !/^[a-f0-9]{128}$/i.test(signature) || !/^[a-f0-9]{64}$/i.test(publicKey || "")) return res.status(401).send("Unauthorized");
  try {
    const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKey, "hex")]), format: "der", type: "spki" });
    if (!verifySignature(null, Buffer.from(timestamp + raw), key, Buffer.from(signature, "hex"))) return res.status(401).send("Unauthorized");
    const i = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (i.type === 1) return reply(res, { type: 1 });


    if (i.type === 3 && i.data?.custom_id?.startsWith("verify:claim:")) {
      if (!i.guild_id) return reply(res, message("서버에서만 인증할 수 있어요.", true));
      background(i, async () => {
        const roleId = i.data.custom_id.split(":")[2];
        if (!/^\d{15,22}$/.test(roleId || "")) return { content: "인증 역할 정보가 잘못됐어요." };
        const uid = i.member?.user?.id || i.user?.id;
        if (i.member?.roles?.includes(roleId)) return { content: "이미 인증된 계정이에요." };
        await discordApi(`/guilds/${i.guild_id}/members/${uid}/roles/${roleId}`, "PUT");
        return { content: `인증 완료! <@&${roleId}> 역할이 지급됐어요.`, allowed_mentions: { parse: [] } };
      });
      return reply(res, { type: 5, data: { flags: 64 } });
    }
    if (i.type === 5 && i.data?.custom_id === "ticket:settings") {
      if (!i.guild_id || !allowed(i, 8n)) return reply(res, message("관리자만 수정할 수 있어요.", true));
      background(i, async () => {
        const { store, config } = await ticketConfig(i.guild_id);
        const fields = Object.fromEntries((i.data.components || []).flatMap(r => r.components || []).map(c => [c.custom_id, c.value]));
        config.title = clip(fields.title || "취즈단 문의센터", 200);
        config.description = clip(fields.description || "아래 버튼을 눌러 비공개 문의 티켓을 열어주세요.", 1000);
        config.welcome = clip(fields.welcome || "문의 내용을 남겨주세요.", 1000);
        const topic = "CHIJU_CONFIG:" + JSON.stringify(config);
        if (topic.length > 1024) throw new Error("설정 내용이 너무 길어요.");
        if (store) await discordApi(`/channels/${store.id}`, "PATCH", { topic });
        else await discordApi(`/guilds/${i.guild_id}/channels`, "POST", {
          name: "chiju-ticket-config", type: 0, topic,
          permission_overwrites: [{ id: i.guild_id, type: 0, deny: "1024" }, { id: APP_ID, type: 1, allow: "68608" }]
        });
        return { content: "문의 제목과 안내 문구를 저장했어요. 새 /문의패널부터 적용돼요." };
      });
      return reply(res, { type: 5, data: { flags: 64 } });
    }
    if (i.type === 3 && i.data?.custom_id === "ticket:open") {
      if (!i.guild_id) return reply(res, message("서버에서만 사용할 수 있어요.", true));
      background(i, async () => {
        const uid = i.member?.user?.id || i.user?.id;
        if (!uid) throw new Error("사용자 정보를 찾을 수 없어요.");
        const { list: existing, config } = await ticketConfig(i.guild_id);
        const old = existing.find(c => c.type === 0 && c.topic === `CHIJU_TICKET:${uid}`);
        if (old) return { content: `이미 열린 티켓이 있어요: <#${old.id}>`, allowed_mentions: { parse: [] } };
        const channel = await discordApi(`/guilds/${i.guild_id}/channels`, "POST", {
          name: `ticket-${uid.slice(-6)}`, type: 0, topic: `CHIJU_TICKET:${uid}`,
          ...(config.category ? { parent_id: config.category } : {}),
          permission_overwrites: [
            { id: i.guild_id, type: 0, deny: "1024" },
            { id: uid, type: 1, allow: "68608" },
            { id: APP_ID, type: 1, allow: "68608" },
            ...(config.staff ? [{ id: config.staff, type: 0, allow: "68608" }] : [])
          ]
        });
        await discordApi(`/channels/${channel.id}/messages`, "POST", {
          content: `<@${uid}> ${config.welcome || "문의 내용을 남겨주세요."}`,
          allowed_mentions: { users: [uid] },
          components: [{ type: 1, components: [{ type: 2, style: 4, label: "티켓 닫기", custom_id: "ticket:close" }] }]
        });
        return { content: `티켓이 열렸어요: <#${channel.id}>`, allowed_mentions: { parse: [] } };
      });
      return reply(res, { type: 5, data: { flags: 64 } });
    }
    if (i.type === 3 && i.data?.custom_id === "ticket:close") {
      if (!i.guild_id) return reply(res, message("서버에서만 사용할 수 있어요.", true));
      background(i, async () => {
        const channel = await discordApi(`/channels/${i.channel_id}`);
        const owner = channel.topic?.match(/^CHIJU_TICKET:(\d+)$/)?.[1];
        if (!owner) return { content: "이 채널은 티켓 채널이 아니에요." };
        if (owner !== i.member?.user?.id && !allowed(i, 16n)) return { content: "티켓 작성자 또는 채널 관리 권한이 필요해요." };
        await discordApi(`/channels/${i.channel_id}`, "DELETE");
        return { content: "티켓을 닫았어요." };
      });
      return reply(res, { type: 5, data: { flags: 64 } });
    }
    if (i.type === 3 && i.data?.custom_id?.startsWith("mod:")) {
      if (!allowed(i, PERMS.MANAGE_MESSAGES)) return reply(res, message("메시지 관리 권한이 필요해요.", true));
      const tips = { "mod:warn": "/경고 유저 사유 — 경고 기록", "mod:lookup": "/경고조회 유저 — 최근 경고 조회", "mod:clean": "/청소 개수 — 메시지 삭제 (1~100)", "mod:kick": "/추방 유저 사유 — 서버에서 추방", "mod:ban": "/차단 유저 사유 — 서버에서 차단" };
      return reply(res, message(tips[i.data.custom_id] || "알 수 없는 기능이에요.", true));
    }
    if (i.type === 3 && i.data?.custom_id?.startsWith("debate:")) {
      const topic = debateTopic(i);
      if (!topic) return reply(res, message("토론 정보를 찾을 수 없어요.", true));
      if (i.data.custom_id === "debate:end") return reply(res, { type: 7, data: { content: "🏁 토론이 종료됐어요.", embeds: i.message.embeds, components: debateButtons(true) } });
      const embed = i.message.embeds[0];
      const round = Math.min(20, Number((embed.footer?.text || "").match(/라운드 (\d+)/)?.[1] || 1) + 1);
      if (round > 20) return reply(res, message("최대 20라운드까지 진행할 수 있어요.", true));
      background(i, async () => ({ embeds: [{ title: `🧀 AI 토론: ${clip(topic, 180)}`, description: await debateRound(topic, round), color: 0xF1C40F, footer: { text: `라운드 ${round}` } }], components: debateButtons() }));
      return reply(res, { type: 6 });
    }
    if (i.type !== 2) return reply(res, message("지원하지 않는 요청이에요.", true));
    const name = i.data?.name;
    if (name === "도움말") return reply(res, { type: 4, data: { embeds: [{ title: "🧀 취즈단봇v2", description: "AI 채팅 · AI 토론 · 서버 관리 · 문의 · 편의 기능\n\n/ai 질문 — Gemini 대화\n/토론 시작 — AI 토론 시작\n토론 메시지의 버튼으로 다음 라운드 또는 종료", color: 0xF1C40F }] } });

    if (name === "인증설정" || name === "인증패널") {
      if (!i.guild_id || !allowed(i, 8n)) return reply(res, message("관리자만 인증 패널을 설정할 수 있어요.", true));
      const roleId = option(i, "역할");
      if (!roleId) return reply(res, message("지급할 인증 역할을 선택해 줘.", true));
      const roles = await discordApi(`/guilds/${i.guild_id}/roles`);
      const role = roles.find(r => r.id === roleId);
      if (!role || role.managed || role.id === i.guild_id || (BigInt(role.permissions) & 8n) === 8n) return reply(res, message("인증용으로 사용할 수 없는 역할이에요.", true));
      const bot = await discordApi(`/guilds/${i.guild_id}/members/${APP_ID}`);
      const highest = Math.max(0, ...roles.filter(r => bot.roles.includes(r.id)).map(r => r.position));
      if (role.position >= highest) return reply(res, message("인증 역할을 봇의 가장 높은 역할보다 아래에 배치해 줘.", true));
      return reply(res, { type: 4, data: {
        embeds: [{ title: "취즈단 서버 인증", description: "아래 버튼을 누르면 인증 역할이 지급됩니다.", color: 0xF1C40F }],
        components: [{ type: 1, components: [{ type: 2, style: 3, label: "인증하기", custom_id: `verify:claim:${roleId}` }] }]
      } });
    }
    if (name === "문의설정") {
      if (!i.guild_id || !allowed(i, 16n)) return reply(res, message("채널 관리 권한이 필요해요.", true));
      if (!i.data?.options?.length) {
        if (!allowed(i, 8n)) return reply(res, message("제목과 내용 변경은 관리자만 가능해요.", true));
        const { config } = await ticketConfig(i.guild_id);
        const field = (id, label, value, style, max) => ({ type: 1, components: [{ type: 4, custom_id: id, label, style, required: true, max_length: max, value: value || "" }] });
        return reply(res, { type: 9, data: { custom_id: "ticket:settings", title: "문의 티켓 설정", components: [
          field("title", "패널 제목", config.title || "취즈단 문의센터", 1, 200),
          field("description", "패널 안내 내용", config.description || "아래 버튼을 눌러 문의해 주세요.", 2, 500),
          field("welcome", "티켓 생성 후 안내 내용", config.welcome || "문의 내용을 남겨주세요.", 2, 500)
        ] } });
      }
      background(i, async () => {
        const { store, config } = await ticketConfig(i.guild_id);
        const category = option(i, "카테고리");
        const staff = option(i, "담당역할");
        if (category) {
          const ch = await discordApi(`/channels/${category}`);
          if (ch.guild_id !== i.guild_id || ch.type !== 4) throw new Error("카테고리 채널을 선택해 줘.");
          config.category = category;
        }
        if (staff) {
          const role = await discordApi(`/guilds/${i.guild_id}/roles`);
          if (!role.some(r => r.id === staff)) throw new Error("서버에 존재하는 역할을 선택해 줘.");
          config.staff = staff;
        }
        if (category || staff) {
          const topic = "CHIJU_CONFIG:" + JSON.stringify(config);
          if (store) await discordApi(`/channels/${store.id}`, "PATCH", { topic });
          else await discordApi(`/guilds/${i.guild_id}/channels`, "POST", {
            name: "chiju-ticket-config", type: 0, topic,
            permission_overwrites: [{ id: i.guild_id, type: 0, deny: "1024" }, { id: APP_ID, type: 1, allow: "68608" }]
          });
        }
        return { content: `🎫 문의 설정 ${category || staff ? "저장 완료" : "조회"}\n카테고리: ${config.category ? "<#" + config.category + ">" : "미설정"}\n담당 역할: ${config.staff ? "<@&" + config.staff + ">" : "미설정"}`, allowed_mentions: { parse: [] } };
      });
      return reply(res, { type: 5, data: { flags: 64 } });
    }
    if (name === "문의패널") {
      if (!i.guild_id || !allowed(i, 16n)) return reply(res, message("서버의 채널 관리 권한이 필요해요.", true));
      const { config } = await ticketConfig(i.guild_id);
      return reply(res, { type: 4, data: {
        embeds: [{ title: clip(config.title || "취즈단 문의센터", 200), description: clip(config.description || "아래 버튼을 눌러 비공개 문의 티켓을 열어주세요.", 1000), color: 0xF1C40F }],
        components: [{ type: 1, components: [{ type: 2, style: 1, label: "문의 티켓 열기", custom_id: "ticket:open" }] }]
      } });
    }
    if (name === "ai") {
      const question = option(i, "질문");
      if (!question) return reply(res, message("질문을 입력해 줘.", true));
      background(i, async () => ({ content: `**질문:** ${clip(question, 250)}\n\n**🧀 Gemini:**\n${await gemini("친절하고 정확하게 한국어로 답하세요. 질문: " + question)}` }));
      return reply(res, { type: 5 });
    }
    if (name === "토론" && i.data?.options?.[0]?.name === "시작") {
      const topic = i.data.options[0].options?.find(o => o.name === "주제")?.value;
      if (!topic) return reply(res, message("토론 주제를 입력해 줘.", true));
      background(i, async () => ({ embeds: [{ title: `🧀 AI 토론: ${clip(topic, 180)}`, description: await debateRound(topic, 1), color: 0xF1C40F, footer: { text: "라운드 1" } }], components: debateButtons() }));
      return reply(res, { type: 5 });
    }
    if (["경고", "경고조회", "추방", "차단", "청소", "관리패널"].includes(name)) {
      if (!i.guild_id) return reply(res, message("서버에서만 사용할 수 있어요.", true));
      const need = ["추방"].includes(name) ? PERMS.KICK : name === "차단" ? PERMS.BAN : PERMS.MANAGE_MESSAGES;
      if (!allowed(i, need)) return reply(res, message("이 명령어를 사용할 권한이 없어요.", true));
      if (name === "관리패널") {
        return reply(res, { type: 4, data: { embeds: [{ title: "🛡️ 취즈단봇v2 관리패널", description: "버튼을 누르면 해당 관리 명령어 사용법을 보여줘요. 실제 조치는 슬래시 명령어에서 실행해요.", color: 0x3498db }], components: [{ type: 1, components: [
          { type: 2, style: 2, label: "경고", custom_id: "mod:warn" },
          { type: 2, style: 2, label: "경고조회", custom_id: "mod:lookup" },
          { type: 2, style: 2, label: "청소", custom_id: "mod:clean" },
          { type: 2, style: 4, label: "추방", custom_id: "mod:kick" },
          { type: 2, style: 4, label: "차단", custom_id: "mod:ban" }
        ] }] } });
      }
      if (name === "청소") {
        const count = Number(option(i, "개수"));
        if (!Number.isInteger(count) || count < 1 || count > 100) return reply(res, message("삭제 개수는 1~100 사이로 입력해 줘.", true));
        background(i, async () => {
          const msgs = await discordApi(`/channels/${i.channel_id}/messages?limit=${count}`);
          const recent = msgs.filter(m => Date.now() - (Number(BigInt(m.id) >> 22n) + 1420070400000) < 14 * 86400000);
          if (recent.length >= 2) await discordApi(`/channels/${i.channel_id}/messages/bulk-delete`, "POST", { messages: recent.map(m => m.id) });
          else if (recent.length === 1) await discordApi(`/channels/${i.channel_id}/messages/${recent[0].id}`, "DELETE");
          return { content: `🧹 ${recent.length}개 메시지 삭제 완료. (14일 이상 된 메시지는 제외)` };
        });
        return reply(res, { type: 5, data: { flags: 64 } });
      }
      const userId = option(i, "유저");
      if (!/^\d{15,22}$/.test(String(userId || ""))) return reply(res, message("대상 유저를 선택해 줘.", true));
      if (userId === i.member?.user?.id && name !== "경고조회") return reply(res, message("자기 자신에게는 사용할 수 없어요.", true));
      const reason = safeReason(option(i, "사유"));
      if (name === "경고" || name === "경고조회") {
        if (!process.env.WARNING_LOG_CHANNEL_ID) return reply(res, message("Vercel 환경변수 WARNING_LOG_CHANNEL_ID에 경고 기록용 채널 ID를 설정해 줘.", true));
        background(i, async () => {
          const channel = process.env.WARNING_LOG_CHANNEL_ID;
          if (name === "경고") {
            const log = `[CHIJU_WARN] guild=${i.guild_id} user=${userId} mod=${i.member.user.id} at=${new Date().toISOString()} reason=${reason}`;
            await discordApi(`/channels/${channel}/messages`, "POST", { content: log, allowed_mentions: { parse: [] } });
            return { content: `⚠️ <@${userId}> 경고 기록 완료. 사유: ${reason}`, allowed_mentions: { parse: [] } };
          }
          const logs = await discordApi(`/channels/${channel}/messages?limit=100`);
          const hits = logs.filter(m => m.author?.bot && m.content?.startsWith(`[CHIJU_WARN] guild=${i.guild_id} user=${userId} `));
          return { content: `📋 <@${userId}> 최근 경고 ${hits.length}건 (최근 로그 100개 기준)\n` + (hits.length ? hits.slice(0, 10).map(m => "• " + clip(m.content.split(" reason=").slice(1).join(" reason="), 140)).join("\n") : "기록 없음"), allowed_mentions: { parse: [] } };
        });
        return reply(res, { type: 5, data: { flags: 64 } });
      }
      background(i, async () => {
        if (name === "추방") await discordApi(`/guilds/${i.guild_id}/members/${userId}`, "DELETE");
        if (name === "차단") await discordApi(`/guilds/${i.guild_id}/bans/${userId}`, "PUT", { delete_message_seconds: 0 });
        return { content: `✅ <@${userId}> ${name} 완료. 사유: ${reason}`, allowed_mentions: { parse: [] } };
      });
      return reply(res, { type: 5, data: { flags: 64 } });
    }
    return reply(res, message("이 명령어는 아직 구현 중이에요.", true));
  } catch (e) { console.error("Discord interaction error", e); return res.status(400).send("Invalid request"); }
}
