import { createPublicKey, verify as verifySignature } from "node:crypto";
import { waitUntil } from "@vercel/functions";

const APP_ID = "1568446216436584518";
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
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
    return reply(res, message("이 명령어는 아직 구현 중이에요.", true));
  } catch (e) { console.error("Discord interaction error", e); return res.status(400).send("Invalid request"); }
}
