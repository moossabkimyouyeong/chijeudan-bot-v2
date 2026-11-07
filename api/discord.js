import { createPublicKey, verify as verifySignature } from "node:crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  const signature = req.headers["x-signature-ed25519"];
  const timestamp = req.headers["x-signature-timestamp"];
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (typeof signature !== "string" || typeof timestamp !== "string" || !/^[a-f0-9]{128}$/i.test(signature || "") || !/^[a-f0-9]{64}$/i.test(publicKey || "")) {
    return res.status(401).send("Unauthorized");
  }
  try {
    const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKey, "hex")]), format: "der", type: "spki" });
    const valid = verifySignature(null, Buffer.from(timestamp + raw), key, Buffer.from(signature, "hex"));
    if (!valid) return res.status(401).send("Unauthorized");
    const interaction = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (interaction.type === 1) return res.status(200).json({ type: 1 });
    if (interaction.type === 2) {
      if (interaction.data?.name === "도움말") {
        return res.status(200).json({ type: 4, data: { embeds: [{ title: "🧀 취즈단봇v2", description: "AI 채팅 · AI 토론 · 서버 관리 · 문의 · 편의 기능", color: 15844367 }] } });
      }
      return res.status(200).json({ type: 4, data: { content: "아직 구현 중인 명령어입니다.", flags: 64 } });
    }
    return res.status(200).json({ type: 4, data: { content: "지원하지 않는 요청입니다.", flags: 64 } });
  } catch (error) {
    console.error("Discord interaction error", error);
    return res.status(400).send("Invalid request");
  }
}
