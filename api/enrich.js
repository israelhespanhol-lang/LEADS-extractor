const ROLE_RE = /(propriet[aá]ri[oa]|fundador(?:a)?|s[oó]ci[oa](?:[- ]administrador(?:a)?)?|administrador(?:a)?|diretor(?:a)?|ceo)/i;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?55[\s().-]*)?(?:\(?\d{2}\)?[\s.-]*)?(?:9?\d{4}[\s.-]*\d{4})/g;
const CNPJ_FORMATTED_RE = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g;
const CNPJ_LABELED_RE = /CNPJ\s*[:#-]?\s*(\d{2}[.\s]?\d{3}[.\s]?\d{3}[\/\s]?\d{4}[-\s]?\d{2})/gi;

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}
function digits(value) {
  return String(value || "").replace(/\D/g, "");
}
function normalizePhone(value) {
  let d = digits(value);
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return "";
  return "55" + d;
}
function cleanCnpj(value) {
  const d = digits(value);
  return d.length === 14 ? d : "";
}
function htmlToText(html) {
  return String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 450000);
}
function publicUrl(input) {
  try {
    const url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const h = url.hostname.toLowerCase();
    if (
      h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local") ||
      /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    ) return null;
    return url;
  } catch {
    return null;
  }
}
async function fetchHtml(input) {
  const url = publicUrl(input);
  if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "LeadRadar/1.0 public-business-enrichment",
        "Accept": "text/html,application/xhtml+xml"
      }
    });
    const type = response.headers.get("content-type") || "";
    if (!response.ok || !type.includes("text/html")) return null;
    const html = (await response.text()).slice(0, 700000);
    return { url: response.url || url.toString(), html, text: htmlToText(html) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
function candidateLinks(html, base) {
  const out = [];
  const re = /href\s*=\s*["']([^"'#]+)["']/gi;
  let match;
  while ((match = re.exec(html))) {
    try {
      const url = new URL(match[1], base);
      const origin = new URL(base);
      if (url.origin !== origin.origin) continue;
      if (!/sobre|quem-somos|equipe|empresa|contato|contact|about|institucional/i.test(url.pathname)) continue;
      url.hash = "";
      out.push(url.toString());
    } catch {}
  }
  return uniq(out).slice(0, 3);
}
function cnpjsFromText(text) {
  const formatted = text.match(CNPJ_FORMATTED_RE) || [];
  const labeled = [];
  let match;
  CNPJ_LABELED_RE.lastIndex = 0;
  while ((match = CNPJ_LABELED_RE.exec(text))) labeled.push(match[1]);
  return uniq([...formatted, ...labeled].map(cleanCnpj));
}
function phonesFromText(text) {
  return uniq((text.match(PHONE_RE) || []).map(normalizePhone));
}
function emailsFromText(text) {
  return uniq((text.match(EMAIL_RE) || []).map((value) => value.toLowerCase()));
}
function hrefs(html) {
  const out = [];
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = re.exec(html))) out.push(match[1].replace(/&amp;/g, "&"));
  return out;
}
function whatsappPhones(html) {
  const out = [];
  for (const link of hrefs(html)) {
    if (!/(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)/i.test(link)) continue;
    const match = link.match(/(?:wa\.me\/|phone=)(\+?\d{10,15})/i);
    if (match) {
      const phone = normalizePhone(match[1]);
      if (phone) out.push(phone);
    }
  }
  return uniq(out);
}
function socialLinks(html, domain) {
  return uniq(hrefs(html).filter((link) => link.toLowerCase().includes(domain))).slice(0, 3);
}
function ownerMentions(text, source) {
  const out = [];
  const re = /(propriet[aá]ri[oa]|fundador(?:a)?|s[oó]ci[oa](?:[- ]administrador(?:a)?)?|administrador(?:a)?|diretor(?:a)?|ceo)\s*[:\-–]?\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç'’-]+(?:\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç'’-]+){1,4})/g;
  let match;
  while ((match = re.exec(text))) {
    if (match[2].length > 5 && match[2].length < 90) {
      out.push({ name: match[2].trim(), role: match[1].trim(), source });
    }
  }
  return out;
}
function ownerPhoneAssociations(text, source) {
  const out = [];
  const re = /(propriet[aá]ri[oa]|fundador(?:a)?|s[oó]ci[oa](?:[- ]administrador(?:a)?)?|administrador(?:a)?|diretor(?:a)?|ceo)/gi;
  let match;
  while ((match = re.exec(text))) {
    const context = text.slice(Math.max(0, match.index - 80), Math.min(text.length, match.index + 280));
    const phones = phonesFromText(context);
    const names = ownerMentions(context, source);
    for (const phone of phones) {
      out.push({
        phone,
        name: names[0]?.name || "",
        role: names[0]?.role || match[1],
        source,
        confidence: names[0]?.name ? "alta" : "media"
      });
    }
  }
  return out;
}
async function brasilApi(cnpj) {
  try {
    const response = await fetch("https://brasilapi.com.br/api/cnpj/v1/" + encodeURIComponent(cnpj), {
      headers: { "User-Agent": "LeadRadar/1.0 targeted-cnpj-lookup" }
    });
    if (!response.ok) return null;
    const data = await response.json();
    return {
      cnpj: cleanCnpj(data.cnpj || cnpj),
      razaoSocial: data.razao_social || "",
      nomeFantasia: data.nome_fantasia || "",
      email: data.email || "",
      phones: uniq([normalizePhone(data.ddd_telefone_1), normalizePhone(data.ddd_telefone_2)]),
      owners: Array.isArray(data.qsa) ? data.qsa.map((item) => ({
        name: item.nome_socio || "",
        role: item.qualificacao_socio || "Sócio/administrador",
        source: "BrasilAPI / Receita Federal"
      })).filter((item) => item.name) : []
    };
  } catch {
    return null;
  }
}
async function serperSearch(query) {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];
  try {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, gl: "br", hl: "pt-br", num: 8 })
    });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.organic) ? data.organic : [];
  } catch {
    return [];
  }
}
function searchSignals(result, owners) {
  const text = String(result.title || "") + " " + String(result.snippet || "");
  const phones = phonesFromText(text);
  const cnpjs = cnpjsFromText(text);
  const ownerContacts = [];
  for (const owner of owners) {
    const first = owner.name.split(/\s+/).filter(Boolean)[0] || "";
    if (!first || !text.toLocaleLowerCase("pt-BR").includes(first.toLocaleLowerCase("pt-BR"))) continue;
    for (const phone of phones) {
      ownerContacts.push({
        phone,
        name: owner.name,
        role: owner.role,
        source: result.link || "",
        confidence: /whatsapp|telefone|contato/i.test(text) ? "alta" : "media"
      });
    }
  }
  return { phones, cnpjs, ownerContacts };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }

  const name = String(req.body?.name || "").trim().slice(0, 180);
  const address = String(req.body?.address || "").trim().slice(0, 240);
  const website = String(req.body?.website || "").trim();
  if (!name) return res.status(400).json({ error: "Nome da empresa é obrigatório." });

  const pages = [];
  const home = website ? await fetchHtml(website) : null;
  if (home) {
    pages.push(home);
    const links = candidateLinks(home.html, home.url);
    const extra = await Promise.all(links.map(fetchHtml));
    for (const page of extra) if (page) pages.push(page);
  }

  let cnpjs = [];
  let phones = [];
  let whatsapps = [];
  let emails = [];
  let owners = [];
  let ownerContacts = [];
  let instagram = [];
  let linkedin = [];
  let facebook = [];
  const evidence = [];

  for (const page of pages) {
    const pageCnpjs = cnpjsFromText(page.text);
    const pagePhones = phonesFromText(page.text);
    const pageWhats = whatsappPhones(page.html);
    const pageEmails = emailsFromText(page.text);
    const pageOwners = ownerMentions(page.text, page.url);
    const associations = ownerPhoneAssociations(page.text, page.url);

    cnpjs.push(...pageCnpjs);
    phones.push(...pagePhones);
    whatsapps.push(...pageWhats);
    emails.push(...pageEmails);
    owners.push(...pageOwners);
    ownerContacts.push(...associations);
    instagram.push(...socialLinks(page.html, "instagram.com"));
    linkedin.push(...socialLinks(page.html, "linkedin.com"));
    facebook.push(...socialLinks(page.html, "facebook.com"));

    if (pageCnpjs[0]) evidence.push({ type: "cnpj", source: page.url, value: pageCnpjs[0] });
    if (pageWhats[0]) evidence.push({ type: "whatsapp_publico", source: page.url, value: pageWhats[0] });
    if (pageOwners[0]) evidence.push({ type: "responsavel_mencionado", source: page.url, value: pageOwners[0].name });
  }

  cnpjs = uniq(cnpjs);
  phones = uniq(phones);
  whatsapps = uniq(whatsapps);
  emails = uniq(emails);

  let registry = null;
  if (cnpjs[0]) {
    registry = await brasilApi(cnpjs[0]);
    if (registry) {
      phones = uniq([...phones, ...registry.phones]);
      emails = uniq([...emails, registry.email]);
      owners = [...registry.owners, ...owners];
      if (registry.owners.length) {
        evidence.push({ type: "quadro_societario", source: "BrasilAPI / Receita Federal", value: registry.owners.slice(0, 3).map((o) => o.name).join(", ") });
      }
    }
  }

  const ownerKeys = new Set();
  owners = owners.filter((owner) => {
    const key = owner.name.toLocaleLowerCase("pt-BR");
    if (!owner.name || ownerKeys.has(key)) return false;
    ownerKeys.add(key);
    return true;
  }).slice(0, 12);

  const searchAvailable = Boolean(process.env.SERPER_API_KEY);
  if (searchAvailable) {
    const firstSearch = await serperSearch('"' + name + '" ' + address + ' CNPJ proprietário sócio fundador WhatsApp');
    for (const result of firstSearch) {
      const signal = searchSignals(result, owners);
      cnpjs.push(...signal.cnpjs);
      phones.push(...signal.phones);
      ownerContacts.push(...signal.ownerContacts);
      if (signal.phones[0]) evidence.push({ type: "telefone_busca_publica", source: result.link || "", value: signal.phones[0] });
    }

    if (!registry && uniq(cnpjs)[0]) {
      registry = await brasilApi(uniq(cnpjs)[0]);
      if (registry) {
        owners = [...registry.owners, ...owners];
        phones = uniq([...phones, ...registry.phones]);
        emails = uniq([...emails, registry.email]);
      }
    }

    for (const owner of owners.slice(0, 2)) {
      const ownerSearch = await serperSearch('"' + owner.name + '" "' + name + '" WhatsApp telefone contato');
      for (const result of ownerSearch) {
        const signal = searchSignals(result, [owner]);
        ownerContacts.push(...signal.ownerContacts);
        if (signal.ownerContacts[0]) {
          evidence.push({ type: "contato_publico_responsavel", source: result.link || "", value: owner.name + ": " + signal.ownerContacts[0].phone });
        }
      }
    }
  }

  const ownerContactKeys = new Set();
  ownerContacts = ownerContacts.filter((contact) => {
    const key = contact.name + "|" + contact.phone;
    if (!contact.phone || ownerContactKeys.has(key)) return false;
    ownerContactKeys.add(key);
    return true;
  }).slice(0, 12);

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    cnpj: registry?.cnpj || uniq(cnpjs)[0] || "",
    company: registry ? { razaoSocial: registry.razaoSocial, nomeFantasia: registry.nomeFantasia } : null,
    owners: owners.slice(0, 10),
    ownerContacts,
    publicContacts: {
      phones: uniq(phones).slice(0, 12),
      whatsapps: uniq(whatsapps).slice(0, 8),
      emails: uniq(emails).slice(0, 8)
    },
    socials: {
      instagram: uniq(instagram).slice(0, 3),
      linkedin: uniq(linkedin).slice(0, 3),
      facebook: uniq(facebook).slice(0, 3)
    },
    evidence: evidence.filter((item) => item.value).slice(0, 16),
    pagesChecked: pages.map((page) => page.url),
    searchAvailable
  });
}
