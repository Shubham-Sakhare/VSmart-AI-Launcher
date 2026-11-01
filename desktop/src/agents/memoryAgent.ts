// memoryAgent.ts
// Save / get / show user facts.
// Supports English, Hindi, Hinglish, and Marathi phrasing.

// ── Key-value extractor ────────────────────────────────────────────────────────
// Handles patterns like:
//   "my name is Shubham"              → {key:"name", value:"Shubham"}
//   "mera naam Shubham hai"           → {key:"naam", value:"Shubham"}
//   "maza avadta rang lal ahe"        → {key:"avadta rang", value:"lal"}
//   "remember that I prefer dark mode" → {key:"preference", value:"I prefer dark mode"}
//   "favourite app is Chrome"         → {key:"favourite app", value:"Chrome"}
function extractKeyValue(text: string): { key: string; value: string } {
  const stripped = text
    .replace(/^(remember|yaad rakh|yaad rakho|note kar|lakshat thev)\s+(that\s+|ki\s+)?/i, "")
    .trim();

  // English: "my <key> is <value>" / "<key> is <value>"
  const enMatch = stripped.match(/^(?:my\s+)?(.+?)\s+is\s+(.+)$/i);
  if (enMatch) {
    return { key: enMatch[1].trim().toLowerCase(), value: enMatch[2].trim() };
  }

  // Hindi: "mera/meri <key> <value> hai"
  const hiMatch = stripped.match(/^(?:mera|meri|mujhe|hamara|hamari)\s+(.+?)\s+(.+?)\s+hai$/i);
  if (hiMatch) {
    return { key: hiMatch[1].trim().toLowerCase(), value: hiMatch[2].trim() };
  }

  // Marathi: "maz/mazi/maze <key> <value> ahe"
  const mrMatch = stripped.match(/^(?:maz[ae]?|mazi)\s+(.+?)\s+(.+?)\s+(?:ahe|ahe\.?)$/i);
  if (mrMatch) {
    return { key: mrMatch[1].trim().toLowerCase(), value: mrMatch[2].trim() };
  }

  // "favourite/preferred/default X is Y" anywhere in sentence
  const prefMatch = stripped.match(/(?:favourite|favorite|preferred|default|avadta|avadati)\s+(.+?)\s+(?:is|ahe|hai)\s+(.+)/i);
  if (prefMatch) {
    return { key: prefMatch[1].trim().toLowerCase(), value: prefMatch[2].trim() };
  }

  // Fallback — store the whole sentence with a timestamp key
  return { key: `note-${new Date().toISOString().slice(0, 10)}`, value: stripped };
}

export async function memoryAgent(
  action: "save" | "get" | "show" | "delete",
  data?: Record<string, unknown>
): Promise<string> {

  switch (action) {

    case "save": {
      // Allow caller to pass explicit {key, value} or just {value}
      const raw = data?.value ?? data?.key ?? "";
      const kv  = data?.key && data?.value
        ? { key: String(data.key), value: String(data.value) }
        : extractKeyValue(String(raw));

      try {
        await window.vsmart.longMemory.saveFact(kv.key.slice(0, 60), kv.value.slice(0, 200));
        return `Yaad kar liya — "${kv.key}" = "${kv.value}".`;
      } catch (e) {
        return `Memory save nahi hua: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    case "get": {
      const query = String(data?.key ?? data?.query ?? "").trim();
      if (!query) return "Kya yaad karna chahte ho — thoda aur batao?";

      try {
        // Exact key match first (fast)
        const exact = await window.vsmart.longMemory.getFact(query);
        if (exact) return `Tumhara ${query} hai: ${exact}`;

        // Semantic search fallback
        const matches = await window.vsmart.longMemory.searchFacts(query, 3);
        if (matches.length > 0) {
          const top = matches[0];
          return `Isske baare mein yaad hai — ${top.key}: ${top.value}`;
        }
        return `"${query}" ke baare mein kuch nahi mila. Pehle save kiya tha?`;
      } catch (e) {
        return `Memory search nahi hua: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    case "show": {
      try {
        const facts = await window.vsmart.longMemory.getAllFacts();
        if (!facts || facts.length === 0) {
          return "Abhi tak kuch save nahi kiya hai tumhare baare mein.";
        }
        const lines = facts.slice(0, 25).map(
          (f: { key: string; value: string }) => `• ${f.key}: ${f.value}`
        );
        return `Yeh sab yaad hai mujhe:\n${lines.join("\n")}`;
      } catch (e) {
        return `Memory fetch nahi hua: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    case "delete": {
      const key = String(data?.key ?? "").trim();
      if (!key) return "Kaunsa memory delete karna hai — key batao.";
      try {
        await window.vsmart.longMemory.deleteFact(key);
        return `"${key}" delete kar diya.`;
      } catch (e) {
        return `Delete nahi hua: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    default:
      return "Unknown memory command.";
  }
}
