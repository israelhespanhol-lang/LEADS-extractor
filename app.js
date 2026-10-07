(() => {
  const els = {
    locationInput: document.getElementById("locationInput"),
    geocodeBtn: document.getElementById("geocodeBtn"),
    radiusSelect: document.getElementById("radiusSelect"),
    categorySelect: document.getElementById("categorySelect"),
    centerLabel: document.getElementById("centerLabel"),
    searchBtn: document.getElementById("searchBtn"),
    configNotice: document.getElementById("configNotice"),
    resultCount: document.getElementById("resultCount"),
    resultsList: document.getElementById("resultsList"),
    statusBar: document.getElementById("statusBar"),
    selectAllBtn: document.getElementById("selectAllBtn"),
    extractContactsBtn: document.getElementById("extractContactsBtn"),
    enrichOwnersBtn: document.getElementById("enrichOwnersBtn"),
    exportBtn: document.getElementById("exportBtn"),
    leadTemplate: document.getElementById("leadTemplate")
  };

  const state = {
    map: null,
    circle: null,
    geocoder: null,
    center: null,
    markers: [],
    places: [],
    details: new Map(),
    enrichment: new Map(),
    selected: new Set(),
    mapsReady: false
  };

  function setStatus(message) {
    els.statusBar.textContent = message;
  }

  function showConfig(message) {
    els.configNotice.hidden = false;
    els.configNotice.textContent = message;
  }

  function hideConfig() {
    els.configNotice.hidden = true;
    els.configNotice.textContent = "";
  }

  async function loadMaps() {
    try {
      const res = await fetch("/api/config");
      const config = await res.json();
      if (!res.ok || !config.googleMapsBrowserKey) {
        throw new Error(config.error || "GOOGLE_MAPS_BROWSER_KEY não configurada.");
      }

      await new Promise((resolve, reject) => {
        window.__leadRadarInit = resolve;
        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(config.googleMapsBrowserKey)}&callback=__leadRadarInit&v=weekly`;
        script.async = true;
        script.onerror = () => reject(new Error("Não foi possível carregar o Google Maps."));
        document.head.appendChild(script);
      });

      initMap();
      hideConfig();
    } catch (error) {
      showConfig(`${error.message} Configure as variáveis de ambiente descritas no README.`);
      setStatus("Aguardando configuração do Google Maps.");
      const placeholder = document.querySelector(".map-placeholder");
      if (placeholder) {
        placeholder.innerHTML = "<strong>Google Maps não configurado</strong><span>Adicione as chaves de ambiente para ativar o mapa e as buscas.</span>";
      }
    }
  }

  function initMap() {
    const initial = { lat: -27.6455, lng: -48.6697 };
    state.map = new google.maps.Map(document.getElementById("map"), {
      center: initial,
      zoom: 13,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      gestureHandling: "greedy"
    });
    state.geocoder = new google.maps.Geocoder();
    state.mapsReady = true;

    state.map.addListener("click", (event) => {
      setCenter({ lat: event.latLng.lat(), lng: event.latLng.lng() }, "Ponto selecionado no mapa");
    });

    els.searchBtn.disabled = false;
    geocodeLocation(true);
  }

  function radiusMeters() {
    return Number(els.radiusSelect.value) || 3000;
  }

  function setCenter(center, label) {
    state.center = center;
    els.centerLabel.textContent = `${label} · ${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`;
    if (state.map) state.map.panTo(center);

    if (state.circle) state.circle.setMap(null);
    state.circle = new google.maps.Circle({
      map: state.map,
      center,
      radius: radiusMeters(),
      fillOpacity: 0.08,
      strokeOpacity: 0.55,
      strokeWeight: 2
    });
  }

  async function geocodeLocation(silent = false) {
    if (!state.mapsReady) return;
    const address = els.locationInput.value.trim();
    if (!address) {
      if (!silent) setStatus("Digite um endereço, bairro ou cidade.");
      return;
    }

    els.geocodeBtn.disabled = true;
    if (!silent) setStatus("Localizando região…");

    try {
      const response = await state.geocoder.geocode({ address });
      if (!response.results?.length) throw new Error("Local não encontrado.");
      const loc = response.results[0].geometry.location;
      const center = { lat: loc.lat(), lng: loc.lng() };
      setCenter(center, response.results[0].formatted_address || address);
      state.map.fitBounds(response.results[0].geometry.viewport);
      if (!silent) setStatus("Região localizada. Ajuste o raio e faça a busca.");
    } catch (error) {
      setStatus(error.message || "Não foi possível localizar essa região.");
    } finally {
      els.geocodeBtn.disabled = false;
    }
  }

  function clearMarkers() {
    state.markers.forEach((marker) => marker.setMap(null));
    state.markers = [];
  }

  function toLatLng(location) {
    if (!location) return null;
    const lat = Number(location.lat ?? location.latitude);
    const lng = Number(location.lng ?? location.longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }

  function addMarkers() {
    clearMarkers();
    const bounds = new google.maps.LatLngBounds();
    state.places.forEach((place, index) => {
      const position = toLatLng(place.location);
      if (!position) return;
      const marker = new google.maps.Marker({
        map: state.map,
        position,
        title: place.displayName?.text || "Estabelecimento",
        label: String(index + 1)
      });
      marker.addListener("click", () => {
        const card = document.querySelector(`[data-place-id="${CSS.escape(place.id)}"]`);
        card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        card?.classList.add("flash");
        window.setTimeout(() => card?.classList.remove("flash"), 850);
      });
      state.markers.push(marker);
      bounds.extend(position);
    });
    if (!bounds.isEmpty()) state.map.fitBounds(bounds, 72);
  }

  async function searchPlaces() {
    if (!state.center) {
      setStatus("Defina o centro da busca primeiro.");
      return;
    }

    els.searchBtn.disabled = true;
    els.searchBtn.textContent = "Buscando…";
    setStatus("Consultando estabelecimentos próximos…");
    state.selected.clear();

    try {
      const res = await fetch("/api/nearby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: state.center.lat,
          lng: state.center.lng,
          radius: radiusMeters(),
          includedType: els.categorySelect.value
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao buscar estabelecimentos.");

      const unique = new Map();
      (data.places || []).forEach((place) => {
        if (place.id && !unique.has(place.id)) unique.set(place.id, place);
      });
      state.places = [...unique.values()];
      renderResults();
      addMarkers();
      setStatus(state.places.length
        ? `${state.places.length} estabelecimentos encontrados. Clique em “Buscar contato” para carregar telefone/site público.`
        : "Nenhum estabelecimento encontrado nessa combinação.");
    } catch (error) {
      state.places = [];
      renderResults();
      setStatus(error.message);
    } finally {
      els.searchBtn.disabled = false;
      els.searchBtn.textContent = "Buscar comércios";
    }
  }

  function primaryTypeLabel(place) {
    const raw = place.primaryTypeDisplayName?.text || place.primaryType || "Comércio";
    return raw.replaceAll("_", " ");
  }

  function renderResults() {
    els.resultCount.textContent = String(state.places.length);
    els.resultsList.innerHTML = "";
    els.selectAllBtn.disabled = state.places.length === 0;
    els.extractContactsBtn.disabled = state.places.length === 0;
    els.enrichOwnersBtn.disabled = state.places.length === 0;
    els.exportBtn.disabled = state.selected.size === 0;

    if (!state.places.length) {
      els.resultsList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">◎</div>
          <strong>Nenhum resultado</strong>
          <span>Tente aumentar o raio ou trocar a categoria.</span>
        </div>`;
      clearMarkers();
      return;
    }

    state.places.forEach((place) => {
      const frag = els.leadTemplate.content.cloneNode(true);
      const card = frag.querySelector(".lead-card");
      card.dataset.placeId = place.id;
      frag.querySelector(".lead-name").textContent = place.displayName?.text || "Sem nome";
      frag.querySelector(".lead-type").textContent = primaryTypeLabel(place);
      frag.querySelector(".lead-address").textContent = place.formattedAddress || "Endereço não informado";

      const selector = frag.querySelector(".lead-selector");
      selector.checked = state.selected.has(place.id);
      selector.addEventListener("change", () => {
        if (selector.checked) state.selected.add(place.id);
        else state.selected.delete(place.id);
        updateSelectionControls();
      });

      const detailsBtn = frag.querySelector(".details-btn");
      detailsBtn.addEventListener("click", () => loadDetails(place.id, card, detailsBtn));

      const enrichBtn = frag.querySelector(".enrich-btn");
      enrichBtn.addEventListener("click", () => enrichPlace(place, card, enrichBtn));

      const mapsLink = frag.querySelector(".maps-link");
      mapsLink.href = `https://www.google.com/maps/search/?api=1&query=Google&query_place_id=${encodeURIComponent(place.id)}`;

      const cached = state.details.get(place.id);
      if (cached) renderDetails(card, cached);
      const enriched = state.enrichment.get(place.id);
      if (enriched) renderEnrichment(card, enriched);
      els.resultsList.appendChild(frag);
    });
  }

  function updateSelectionControls() {
    els.exportBtn.disabled = state.selected.size === 0;
    els.extractContactsBtn.disabled = state.places.length === 0;
    els.enrichOwnersBtn.disabled = state.places.length === 0;
    els.selectAllBtn.textContent = state.selected.size === state.places.length && state.places.length
      ? "Desmarcar todos"
      : "Selecionar todos";
    setStatus(state.selected.size
      ? `${state.selected.size} lead(s) selecionado(s).`
      : `${state.places.length} estabelecimentos disponíveis.`);
  }

  async function loadDetails(placeId, card, button) {
    if (state.details.has(placeId)) {
      renderDetails(card, state.details.get(placeId));
      return;
    }

    button.disabled = true;
    button.textContent = "Carregando…";
    try {
      const res = await fetch(`/api/details?id=${encodeURIComponent(placeId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao carregar detalhes.");
      state.details.set(placeId, data);
      renderDetails(card, data);
      button.textContent = "Contato carregado";
    } catch (error) {
      button.textContent = "Tentar novamente";
      setStatus(error.message);
    } finally {
      button.disabled = false;
    }
  }

  async function extractAllContacts() {
    if (!state.places.length) return;

    const pending = state.places.filter((place) => !state.details.has(place.id));
    if (!pending.length) {
      setStatus("Os contatos disponíveis desta busca já foram carregados.");
      return;
    }

    els.extractContactsBtn.disabled = true;
    els.extractContactsBtn.textContent = "Extraindo…";

    let completed = 0;
    let phones = 0;
    let failures = 0;

    const queue = [...pending];
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const place = queue.shift();
        if (!place) break;
        try {
          const res = await fetch(`/api/details?id=${encodeURIComponent(place.id)}`);
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Falha ao carregar detalhes.");
          state.details.set(place.id, data);
          if (data.internationalPhoneNumber || data.nationalPhoneNumber) phones += 1;
          const card = document.querySelector(`[data-place-id="${CSS.escape(place.id)}"]`);
          if (card) {
            renderDetails(card, data);
            const btn = card.querySelector(".details-btn");
            if (btn) btn.textContent = "Contato carregado";
          }
        } catch {
          failures += 1;
        } finally {
          completed += 1;
          setStatus(`Extraindo contatos: ${completed}/${pending.length} · ${phones} telefone(s) encontrado(s)${failures ? ` · ${failures} falha(s)` : ""}.`);
        }
      }
    });

    await Promise.all(workers);

    els.extractContactsBtn.disabled = false;
    els.extractContactsBtn.textContent = "Extrair contatos";
    setStatus(`Extração concluída: ${phones} telefone(s) encontrado(s) em ${pending.length} estabelecimento(s)${failures ? `, com ${failures} falha(s)` : ""}. Alguns negócios podem não publicar telefone no Google.`);
  }

  async function ensureDetails(place) {
    if (state.details.has(place.id)) return state.details.get(place.id);
    const res = await fetch("/api/details?id=" + encodeURIComponent(place.id));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Falha ao carregar os detalhes do Google.");
    state.details.set(place.id, data);
    const card = document.querySelector('[data-place-id="' + CSS.escape(place.id) + '"]');
    if (card) {
      renderDetails(card, data);
      const detailsBtn = card.querySelector(".details-btn");
      if (detailsBtn) detailsBtn.textContent = "Contato carregado";
    }
    return data;
  }

  async function enrichPlace(place, card, button) {
    if (state.enrichment.has(place.id)) {
      renderEnrichment(card, state.enrichment.get(place.id));
      return state.enrichment.get(place.id);
    }

    if (button) {
      button.disabled = true;
      button.textContent = "Investigando…";
    }

    try {
      const details = await ensureDetails(place);
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: place.displayName?.text || "",
          address: place.formattedAddress || "",
          website: details.websiteUri || ""
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha no enriquecimento empresarial.");
      state.enrichment.set(place.id, data);
      if (card) renderEnrichment(card, data);
      if (button) button.textContent = "Responsável investigado";
      return data;
    } catch (error) {
      if (button) button.textContent = "Tentar novamente";
      throw error;
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function enrichAllOwners() {
    if (!state.places.length) return;
    const pending = state.places.filter((place) => !state.enrichment.has(place.id));
    if (!pending.length) {
      setStatus("Os estabelecimentos desta busca já foram investigados.");
      return;
    }

    els.enrichOwnersBtn.disabled = true;
    els.enrichOwnersBtn.textContent = "Investigando…";

    let completed = 0;
    let ownersFound = 0;
    let directContacts = 0;
    let failures = 0;
    const queue = [...pending];

    const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
      while (queue.length) {
        const place = queue.shift();
        if (!place) break;
        const card = document.querySelector('[data-place-id="' + CSS.escape(place.id) + '"]');
        const button = card?.querySelector(".enrich-btn") || null;
        try {
          const data = await enrichPlace(place, card, button);
          if (data?.owners?.length) ownersFound += 1;
          if (data?.ownerContacts?.length) directContacts += 1;
        } catch {
          failures += 1;
        } finally {
          completed += 1;
          setStatus(
            "Investigando responsáveis: " + completed + "/" + pending.length +
            " · " + ownersFound + " com responsável identificado" +
            " · " + directContacts + " com contato público associado" +
            (failures ? " · " + failures + " falha(s)" : "")
          );
        }
      }
    });

    await Promise.all(workers);
    els.enrichOwnersBtn.disabled = false;
    els.enrichOwnersBtn.textContent = "Enriquecer responsáveis";
    setStatus(
      "Investigação concluída: " + ownersFound + " empresa(s) com responsável identificado e " +
      directContacts + " com contato público associado ao responsável." +
      (failures ? " " + failures + " consulta(s) falharam." : "")
    );
  }

  function formatCnpj(value) {
    const d = String(value || "").replace(/\D/g, "");
    if (d.length !== 14) return value || "";
    return d.slice(0,2) + "." + d.slice(2,5) + "." + d.slice(5,8) + "/" + d.slice(8,12) + "-" + d.slice(12);
  }

  function safeSourceLink(source) {
    if (!/^https?:\/\//i.test(source || "")) return escapeHtml(source || "");
    const safe = escapeHtml(source);
    return '<a href="' + safe + '" target="_blank" rel="noopener">fonte pública</a>';
  }

  function renderEnrichment(card, data) {
    const box = card.querySelector(".lead-enrichment");
    if (!box) return;

    const owners = (data.owners || []).slice(0, 4);
    const direct = (data.ownerContacts || []).slice(0, 4);
    const publicPhones = data.publicContacts?.phones || [];
    const whats = data.publicContacts?.whatsapps || [];
    const emails = data.publicContacts?.emails || [];
    const instagram = data.socials?.instagram || [];

    let html = '<div><strong>Investigação empresarial</strong></div>';
    html += '<div><strong>CNPJ:</strong> ' + (data.cnpj ? escapeHtml(formatCnpj(data.cnpj)) : "não localizado") + '</div>';

    if (data.company?.razaoSocial) {
      html += '<div><strong>Razão social:</strong> ' + escapeHtml(data.company.razaoSocial) + '</div>';
    }

    if (owners.length) {
      html += '<div><strong>Responsável/sócio:</strong> ' + owners.map((o) =>
        escapeHtml(o.name) + (o.role ? " (" + escapeHtml(o.role) + ")" : "")
      ).join("; ") + '</div>';
    } else {
      html += '<div><strong>Responsável/sócio:</strong> não identificado com segurança</div>';
    }

    if (direct.length) {
      html += '<div><strong>Contato público do responsável:</strong><br>' + direct.map((item) =>
        escapeHtml(item.phone) +
        (item.name ? " · " + escapeHtml(item.name) : "") +
        " · confiança " + escapeHtml(item.confidence || "media") +
        (item.source ? " · " + safeSourceLink(item.source) : "")
      ).join("<br>") + '</div>';
    } else {
      html += '<div><strong>Contato do responsável:</strong> nenhum número publicamente associado com segurança</div>';
    }

    if (whats.length) html += '<div><strong>WhatsApp público:</strong> ' + whats.map(escapeHtml).join(", ") + '</div>';
    if (publicPhones.length) html += '<div><strong>Telefones públicos encontrados:</strong> ' + publicPhones.slice(0,4).map(escapeHtml).join(", ") + '</div>';
    if (emails.length) html += '<div><strong>E-mails públicos:</strong> ' + emails.slice(0,3).map(escapeHtml).join(", ") + '</div>';
    if (instagram.length) html += '<div><strong>Instagram:</strong> ' + instagram.slice(0,2).map((url) => safeSourceLink(url)).join(", ") + '</div>';

    if (!data.searchAvailable) {
      html += '<div class="enrich-note">Busca web avançada ainda não configurada. Com SERPER_API_KEY, o sistema também pesquisa fontes públicas fora do site oficial.</div>';
    }

    box.innerHTML = html;
    box.hidden = false;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function renderDetails(card, details) {
    const box = card.querySelector(".lead-details");
    const tel = details.internationalPhoneNumber || details.nationalPhoneNumber || "";
    const site = details.websiteUri || "";
    const rating = details.rating ? `${details.rating} (${details.userRatingCount || 0} avaliações)` : "não informada";
    box.innerHTML = `
      <div><strong>Telefone:</strong> ${tel ? escapeHtml(tel) : "não informado"}</div>
      <div><strong>Site:</strong> ${site ? `<a href="${escapeHtml(site)}" target="_blank" rel="noopener">${escapeHtml(site)}</a>` : "não informado"}</div>
      <div><strong>Avaliação:</strong> ${escapeHtml(rating)}</div>
    `;
    box.hidden = false;
  }

  function csvCell(value) {
    const text = String(value ?? "");
    return `"${text.replaceAll('"', '""')}"`;
  }

  function exportCsv() {
    const chosen = state.places.filter((p) => state.selected.has(p.id));
    if (!chosen.length) return;

    const headers = ["nome","categoria","endereco","telefone_google","site","avaliacao","total_avaliacoes","cnpj","razao_social","responsaveis","contato_publico_responsavel","confianca_contato_responsavel","whatsapp_publico","emails_publicos","instagram","fonte_contato_responsavel","place_id","latitude","longitude"];
    const rows = chosen.map((place) => {
      const d = state.details.get(place.id) || {};
      const e = state.enrichment.get(place.id) || {};
      const ownerContact = e.ownerContacts?.[0] || {};
      return [
        place.displayName?.text || "",
        primaryTypeLabel(place),
        place.formattedAddress || "",
        d.internationalPhoneNumber || d.nationalPhoneNumber || "",
        d.websiteUri || "",
        d.rating || "",
        d.userRatingCount || "",
        e.cnpj || "",
        e.company?.razaoSocial || "",
        (e.owners || []).map((o) => o.name + (o.role ? " (" + o.role + ")" : "")).join(" | "),
        ownerContact.phone || "",
        ownerContact.confidence || "",
        (e.publicContacts?.whatsapps || []).join(" | "),
        (e.publicContacts?.emails || []).join(" | "),
        (e.socials?.instagram || []).join(" | "),
        ownerContact.source || "",
        place.id,
        place.location?.latitude ?? place.location?.lat ?? "",
        place.location?.longitude ?? place.location?.lng ?? ""
      ];
    });

    const csv = "\ufeff" + [headers, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lead-radar-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus(`CSV exportado com ${chosen.length} lead(s).`);
  }

  els.geocodeBtn.addEventListener("click", () => geocodeLocation(false));
  els.locationInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") geocodeLocation(false);
  });
  els.radiusSelect.addEventListener("change", () => {
    if (state.center) setCenter(state.center, els.centerLabel.textContent.split(" · ")[0] || "Centro da busca");
  });
  els.searchBtn.addEventListener("click", searchPlaces);
  els.selectAllBtn.addEventListener("click", () => {
    if (state.selected.size === state.places.length) state.selected.clear();
    else state.places.forEach((place) => state.selected.add(place.id));
    renderResults();
    updateSelectionControls();
  });
  els.extractContactsBtn.addEventListener("click", extractAllContacts);
  els.enrichOwnersBtn.addEventListener("click", enrichAllOwners);
  els.exportBtn.addEventListener("click", exportCsv);

  loadMaps();
})();