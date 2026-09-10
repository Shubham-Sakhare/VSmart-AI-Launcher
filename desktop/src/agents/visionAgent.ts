import { askVision } from "../llm/openrouter";
import type { ReplyLang } from "../llm/openrouter";

export async function visionAgent(
  command: string,
  lang: ReplyLang = "en"
): Promise<string> {

  const imageDataUrl = await window.vsmart.vision.captureScreen();

  if (!imageDataUrl) {
    return lang === "hi"
      ? "माफ़ कीजिए बॉस, स्क्रीन कैप्चर नहीं हो पाई।"
      : "Sorry Boss, I couldn't capture the screen.";
  }

  const wantsAction = /\b(click|dabao|press|type|likho|button|icon|open|select)\b/i.test(command);

  const question = command.trim().length > 3
    ? command
    : (lang === "hi"
        ? "इस स्क्रीन पर क्या दिख रहा है, साफ़ और सीधे तरीके से बताओ।"
        : "Describe clearly and concisely what's shown on this screen.");

  // When user wants interaction, ask vision model for structured actions too
  const prompt = wantsAction
    ? `${question}

If you can identify a clear clickable target, also return a JSON block at the end in this exact shape:
{"actions":[{"tool":"click","args":{"x":123,"y":456},"reason":"short"},{"tool":"type_text","args":{"text":"..."},"reason":"..."}]}
Only include actions you are confident about. Coordinates must be absolute screen pixels.`
    : question;

  try {
    const reply = await askVision(prompt, imageDataUrl, lang);

    // Try to extract and execute any structured actions the model returned
    if (wantsAction) {
      const jsonMatch = reply.match(/\{[\s\S]*"actions"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed.actions) && parsed.actions.length > 0) {
            const results: string[] = [];
            for (const step of parsed.actions) {
              if (step.tool === "click" && step.args?.x != null && step.args?.y != null) {
                const ok = await window.vsmart.desktopControl.click(
                  Number(step.args.x),
                  Number(step.args.y),
                  "left",
                  false
                );
                results.push(ok
                  ? `Clicked (${step.args.x}, ${step.args.y}) — ${step.reason || ""}`
                  : `Click failed at (${step.args.x}, ${step.args.y})`);
              } else if (step.tool === "type_text" && step.args?.text) {
                const ok = await window.vsmart.desktopControl.type(String(step.args.text));
                results.push(ok ? `Typed: ${step.args.text}` : "Type failed");
              }
            }
            if (results.length) {
              // Return natural description + what was done
              const cleanDesc = reply.replace(jsonMatch[0], "").trim();
              return [cleanDesc, ...results].filter(Boolean).join("\n");
            }
          }
        } catch {
          // JSON parse failed — fall through to plain reply
        }
      }
    }

    return reply;
  } catch (err) {
    console.error("visionAgent error:", err);
    return lang === "hi"
      ? "माफ़ कीजिए बॉस, स्क्रीन समझने में दिक्कत आई।"
      : "Sorry Boss, I had trouble understanding the screen.";
  }
}