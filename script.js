/* ==========================================================================
   CONFIGURAÇÕES GERAIS E VARIÁVEIS DE ESTADO
   ========================================================================== */
// URL do Google Apps Script que atua como nosso Banco de Dados / API
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwfQKct4Q0g3IhvnI6Huu4tN8GVVVpMNSaE1Xxu9-cA3MFLYYRqPLCGxxztTeJtMPKH/exec";

let currentSeasonData = []; // Matriz com todos os dados baixados da planilha
let currentSeasonName = ""; // Nome da aba ativa no Google Sheets
let viewingEp = 1; // Episódio que o usuário está visualizando no momento
let maxEp = 1; // Último episódio preenchido na temporada
let chartsObj = { evo: null, rank: null }; // Guarda instâncias do Chart.js para destruí-las ao atualizar
let globalRaceData = []; // Dados processados especificamente para a corrida de barras
const baseCols = 5; // Número de colunas fixas antes dos episódios (Nome, Idade, Estado, Profissão, Status)

/* ==========================================================================
   FUNÇÕES DE CONEXÃO COM A API (Google Apps Script)
   Tecnologia: Fetch API (JavaScript Moderno assíncrono)
   ========================================================================== */
async function safeFetch(url, options = {}) {
    options.redirect = "follow"; // Essencial para lidar com redirecionamentos do Google
    const res = await fetch(url, options);
    const text = await res.text();
    try {
        return JSON.parse(text); // Tenta ler como JSON
    } catch (e) {
        // Trata erro caso o Google envie uma tela de bloqueio HTML em vez dos dados JSON
        throw new Error(text.includes("<html") ? "Permissão negada pelo Google." : "Erro no servidor.");
    }
}

// Inicializa o app, buscando as temporadas (abas) cadastradas
async function init() {
    try {
        const seasons = await safeFetch(SCRIPT_URL + "?action=listSeasons");
        document.getElementById("loadingScreen").classList.add("hidden");
        const list = document.getElementById("seasonList");
        
        // Cria um botão para cada temporada encontrada
        seasons.forEach((s) => {
            const b = document.createElement("button");
            b.className = "modal-btn";
            b.style.padding = "20px";
            b.innerText = s;
            b.onclick = () => loadSeasonDashboard(s);
            list.appendChild(b);
        });
        document.getElementById("seasonSelector").classList.remove("hidden");
    } catch (e) {
        document.getElementById("loadingError").innerHTML = `${e.message} <br><br><button class="btn" onclick="location.reload()">Tentar Novamente</button>`;
    }
}

/* ==========================================================================
   CRIAR E EDITAR TEMPORADA
   ========================================================================== */
// Exibe formulário para nova temporada
function showNewSeasonForm() {
    document.getElementById("seasonSelector").classList.add("hidden");
    document.getElementById("newSeasonForm").classList.remove("hidden");
    addParticipantRow("participantsContainer");
}

// Adiciona uma linha de inputs para inserir um participante
function addParticipantRow(containerId) {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.gap = "5px";
    row.style.marginBottom = "5px";
    row.className = "participant-row";
    row.innerHTML = `
        <input type="text" placeholder="Nome" class="p-nome" style="margin:0;">
        <input type="text" placeholder="Estado (SP)" style="width: 80px; margin:0;">
        <button class="btn-outline" style="border-color: var(--mc-red); color: var(--mc-red); padding: 0 15px;" onclick="this.parentElement.remove()">X</button>
    `;
    document.getElementById(containerId).appendChild(row);
}

// Empacota os dados da nova temporada e envia via POST
async function saveNewSeason() {
    const name = document.getElementById("seasonNameInput").value.trim();
    if (!name) return;
    const parts = [];
    document.querySelectorAll("#newSeasonForm .participant-row").forEach((r) => {
        const n = r.querySelector(".p-nome").value.trim();
        if (n) parts.push({ nome: n, idade: "", estado: r.children[1].value, profissao: "" });
    });
    
    document.getElementById("newSeasonForm").innerHTML = "<h2>Criando na planilha...</h2>";
    await fetch(SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // Burla o CORS preflight
        body: JSON.stringify({ action: "createSeason", seasonName: name, participants: parts }),
    });
    location.reload();
}

// Prepara o modal para edição de temporada existente
function openEditSeasonForm() {
    document.getElementById("settingsModal").classList.add("hidden");
    document.getElementById("editSeasonName").value = currentSeasonName;
    document.getElementById("editParticipantsContainer").innerHTML = "";
    document.getElementById("editSeasonModal").classList.remove("hidden");
}

// Envia dados editados da temporada atual
async function saveEditedSeason() {
    const newName = document.getElementById("editSeasonName").value.trim();
    const parts = [];
    document.querySelectorAll("#editSeasonModal .participant-row").forEach((r) => {
        const n = r.querySelector(".p-nome").value.trim();
        if (n) parts.push({ nome: n, estado: r.children[1].value });
    });

    document.getElementById("editSeasonModal").innerHTML = "<div class='modal-content'><h2>Salvando alterações...</h2></div>";
    await fetch(SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "editSeason", oldName: currentSeasonName, newName: newName, newParticipants: parts }),
    });
    location.reload();
}

/* ==========================================================================
   CARREGAMENTO DE DASHBOARD E RENDERIZAÇÃO DE EPISÓDIOS
   ========================================================================== */
// Baixa os dados da temporada selecionada
async function loadSeasonDashboard(seasonName, openTab = "tab-pontuar") {
    currentSeasonName = seasonName;
    document.getElementById("seasonSelector").classList.add("hidden");
    document.getElementById("tab-pontuar").classList.add("hidden");
    document.getElementById("loadingScreen").classList.remove("hidden");

    try {
        const data2D = await safeFetch(SCRIPT_URL + `?action=readSeason&name=${encodeURIComponent(seasonName)}`);
        currentSeasonData = data2D;
        maxEp = data2D[0].length - baseCols; // Calcula quantos episódios existem
        viewingEp = maxEp + 1; // Ajusta o ponteiro para o próximo episódio vazio

        document.getElementById("loadingScreen").classList.add("hidden");
        document.getElementById("epNavBar").classList.remove("hidden");
        document.getElementById("bottomNav").classList.remove("hidden");

        renderEpisode(); // Monta a tabela de pontos
        buildRaceAndRanking(data2D, maxEp); // Monta gráficos e animação de corrida

        const navBtn = document.querySelector(`.nav-item[onclick*="${openTab}"]`);
        switchTab(openTab, navBtn);
    } catch (e) {
        alert("Erro ao carregar");
        location.reload();
    }
}

// Renderiza a interface de notas baseada no episódio ativo (`viewingEp`)
function renderEpisode() {
    document.getElementById("displayEpNumber").innerText = viewingEp;
    document.getElementById("prevEp").disabled = viewingEp <= 1;
    document.getElementById("nextEp").disabled = viewingEp > maxEp;

    const isPast = viewingEp <= maxEp; // Define se estamos visualizando o passado (Modo Edição)
    const tbody = document.getElementById("scoringBody");
    tbody.innerHTML = "";

    document.getElementById("avisoEdicao").classList.toggle("hidden", !isPast);

    const btnSalvar = document.getElementById("btnSalvarEpi");
    btnSalvar.innerText = isPast ? "Atualizar Episódio" : "Salvar Episódio";
    btnSalvar.className = isPast ? "btn-warning" : "btn";

    // Itera pela matriz pulando o cabeçalho (slice 1)
    currentSeasonData.slice(1).forEach((row, index) => {
        const nome = row[0];
        const status = row[4];
        const tr = document.createElement("tr");

        let ptsSalvos = isPast ? row[baseCols + viewingEp - 1] || 0 : 100;

        // Lógica de eliminação: se caiu em episódio anterior, não renderiza inputs
        let wasEliminatedBefore = false;
        if (status === "Eliminado") {
            if (viewingEp > 1 && (row[baseCols + viewingEp - 2] === 0 || row[baseCols + viewingEp - 2] === "")) {
                wasEliminatedBefore = true;
            }
        }

        if (wasEliminatedBefore) {
            tr.className = "eliminado-row";
            tr.innerHTML = `<td class="name-col">${nome}</td><td colspan="3" style="text-align:center;">Eliminado</td>`;
        } else {
            tr.innerHTML = `
                <td class="name-col">${nome}</td>
                <td>
                    <select class="prova1" onchange="calcPts(${index}, this)">
                        <option value="50">Média</option>
                        <option value="100">Venceu (100)</option>
                        <option value="90">Destaq+ (90)</option>
                        <option value="40">Destaq- (40)</option>
                    </select>
                </td>
                <td>
                    <select class="prova2" onchange="calcPts(${index}, this)">
                        <option value="50">Média</option>
                        <option value="80">Venceu (80)</option>
                        <option value="70">Destaq+ (70)</option>
                        <option value="60">Mezanino (60)</option>
                        <option value="30">Destaq- (30)</option>
                        <option value="0">Eliminado</option>
                    </select>
                </td>
                <td class="pontos-total" id="tot-${index}">${ptsSalvos}</td>
            `;
        }
        tr.dataset.rowIndex = index;
        tbody.appendChild(tr);
    });
}

// Navegação de histórico de episódios
function navEp(dir) {
    viewingEp += dir;
    if (viewingEp < 1) viewingEp = 1;
    if (viewingEp > maxEp + 1) viewingEp = maxEp + 1;
    renderEpisode();
}

// Lógica de cálculo matemático do sistema de pontos e indicação visual de imunidade
window.calcPts = function (index, el) {
    const row = el.closest("tr");
    const v1 = parseInt(row.querySelector(".prova1").value);
    const p2 = row.querySelector(".prova2");

    // Destaque na Prova 1 sugere salvar via borda verde, mas não trava
    if (v1 === 100 || v1 === 90) p2.style.border = "2px solid var(--success)";
    else p2.style.border = "1px solid var(--border)";

    document.getElementById(`tot-${index}`).innerText = v1 + parseInt(p2.value);
    row.style.background = parseInt(p2.value) === 0 ? "rgba(255,0,0,0.1)" : "";
};

// Submete a pontuação da tabela atual
async function submitEpisodeScores() {
    const rows = document.querySelectorAll("#scoringBody tr:not(.eliminado-row)");
    const scores = [];
    rows.forEach((r) => {
        const p2Val = parseInt(r.querySelector(".prova2").value);
        scores.push({
            rowIndex: parseInt(r.dataset.rowIndex),
            score: parseInt(r.querySelector(".pontos-total").innerText),
            isEliminated: p2Val === 0,
        });
    });

    document.getElementById("btnSalvarEpi").innerText = "Enviando para a planilha...";
    await fetch(SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
            action: "saveEpisode",
            seasonName: currentSeasonName,
            episodeNumber: viewingEp,
            scores: scores,
        }),
    });

    // Pula para a aba de evolução recarregando a planilha
    loadSeasonDashboard(currentSeasonName, "tab-evolucao");
}

/* ==========================================================================
   UI E NAVEGAÇÃO DE ABAS
   ========================================================================== */
function switchTab(tabId, btn) {
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.add("hidden"));
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
    document.getElementById(tabId).classList.remove("hidden");
    if (btn) btn.classList.add("active");
}

function toggleSettings() {
    document.getElementById("settingsModal").classList.toggle("hidden");
}

function toggleTheme() {
    document.body.classList.toggle("dark-mode");
    toggleSettings();
}

/* ==========================================================================
   GRÁFICOS E ANIMAÇÃO (Chart.js / DOM Manipulation)
   ========================================================================== */
function buildRaceAndRanking(data, epCount) {
    if (epCount === 0) return;

    // PREPARAÇÃO: Ordena os participantes alfabeticamente para a corrida de barras
    let rows = data.slice(1);
    rows.sort((a, b) => a[0].localeCompare(b[0])); 

    // Mapeia histórico e status de eliminação de cada um
    globalRaceData = rows.map((row, idx) => {
        let history = [];
        let acc = 0;
        let elimEp = -1;

        for (let e = 0; e < epCount; e++) {
            let pts = row[baseCols + e];
            if (pts === "" || pts == null) pts = 0;
            acc += pts;
            history.push(acc);
            if (pts === 0 && row[4] === "Eliminado" && elimEp === -1) elimEp = e;
        }
        return { id: idx, name: row[0], history, elimEp };
    });

    // CONSTRUÇÃO DOM DA CORRIDA
    const track = document.getElementById("raceTrack");
    track.innerHTML = "";
    globalRaceData.forEach(p => {
        const col = document.createElement("div");
        col.className = "race-col";
        col.id = `race-col-${p.id}`;
        col.innerHTML = `
            <div class="race-grow-area">
                <div class="race-bar" id="race-fill-${p.id}" style="height: 0%;">
                    <div class="race-photo" id="race-img-${p.id}">${p.name.charAt(0)}</div>
                    <div class="race-score" id="race-score-${p.id}">0</div>
                </div>
            </div>
            <div class="race-name">${p.name}</div>
        `;
        track.appendChild(col);
    });

    // Configura o Scrubber (barra deslizante de tempo)
    const scrubber = document.getElementById("epScrubber");
    scrubber.max = epCount;
    scrubber.value = epCount;

    scrubRace(epCount); // Pula para o episódio final na corrida
    drawRankingChart(data, epCount); // Desenha o gráfico Chart.js tradicional
}

// Função chamada sempre que o usuário arrasta o controle deslizante de tempo
window.scrubRace = function(epNumber) {
    document.getElementById("scrubEpDisplay").innerText = epNumber;
    const epIndex = epNumber - 1;

    // Acha a nota máxima do episódio selecionado para usar como 100% de altura
    let maxPts = 1;
    globalRaceData.forEach(p => {
        if (p.elimEp === -1 || epIndex <= p.elimEp) {
            if (p.history[epIndex] > maxPts) maxPts = p.history[epIndex];
        }
    });

    // Atualiza alturas e esconde mortos
    globalRaceData.forEach(p => {
        const col = document.getElementById(`race-col-${p.id}`);
        const fill = document.getElementById(`race-fill-${p.id}`);
        const scoreLabel = document.getElementById(`race-score-${p.id}`);

        if (p.elimEp !== -1 && epIndex > p.elimEp) {
            col.style.display = "none"; // Oculta espaço
        } else {
            col.style.display = "flex";
            let pts = p.history[epIndex];
            scoreLabel.innerText = pts;
            fill.style.height = (pts / maxPts * 100) + "%"; // Altura relativa ao lider
        }
    });
}

// Plota o gráfico de Ranking invertido utilizando a biblioteca Chart.js
function drawRankingChart(data, epCount) {
    const labels = Array.from({ length: epCount }, (_, i) => `Ep ${i + 1}`);
    const colors = ["#ff5252", "#4caf50", "#ffeb3b", "#448aff", "#ff9800", "#e040fb", "#00bcd4"];
    let rows = data.slice(1);
    let rankingDataMatrix = [];

    // Calcula os totais acumulados de cada um
    rows.forEach((row) => {
        let pointsHistory = [];
        let acc = 0;
        for (let e = 0; e < epCount; e++) {
            acc += row[baseCols + e] || 0;
            pointsHistory.push(acc);
        }
        rankingDataMatrix.push(pointsHistory);
    });

    let rankDatasets = [];
    rows.forEach((row, pIndex) => {
        let rankHistory = [];
        for (let e = 0; e < epCount; e++) {
            let ptsNoEp = rankingDataMatrix.map((h) => h[e]);
            let ordenados = [...new Set(ptsNoEp)].sort((a, b) => b - a); // Define a escada de pontuações
            let meusPts = rankingDataMatrix[pIndex][e];
            
            // Atribui nulo se foi eliminado no passado, senao calcula a posição do index
            if (row[4] === "Eliminado" && e > 0 && meusPts === rankingDataMatrix[pIndex][e - 1]) {
                rankHistory.push(null);
            } else {
                rankHistory.push(ordenados.indexOf(meusPts) + 1);
            }
        }
        rankDatasets.push({ label: row[0], data: rankHistory, borderColor: colors[pIndex % colors.length], spanGaps: true });
    });

    if (chartsObj.rank) chartsObj.rank.destroy(); // Reseta instâncias antigas
    chartsObj.rank = new Chart(document.getElementById("rankingChart"), {
        type: "line",
        data: { labels: labels, datasets: rankDatasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { reverse: true, min: 1, ticks: { stepSize: 1 } } }, // reverse: true inverte o eixo Y para o #1 ficar em cima
            plugins: { legend: { position: "bottom" } },
        },
    });
}

/* ==========================================================================
   REQUISIÇÃO DE INTELIGÊNCIA ARTIFICIAL
   ========================================================================== */
async function analisarComIA() {
    if (currentSeasonData.length <= 1) return alert("Sem dados suficientes.");
    const resDiv = document.getElementById("iaResult");
    resDiv.innerHTML = "<em>Cozinhando os dados...</em>";

    // Extrai o conteúdo bruto da planilha para passar para o LLM via string simples
    const epCount = currentSeasonData[0].length - baseCols;
    let txt = "NOME|STATUS|PONTOS\n";
    currentSeasonData.slice(1).forEach((r) => {
        let pts = [];
        for (let i = 0; i < epCount; i++) pts.push(`E${i + 1}:${r[baseCols + i] || 0}`);
        txt += `${r[0]}|${r[4]}|${pts.join(",")}\n`;
    });

    try {
        const res = await fetch(SCRIPT_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            redirect: "follow",
            body: JSON.stringify({ action: "analyzeAI", promptText: `Analise o MasterChef:\n${txt}` }),
        });
        let html = await res.text();
        
        // Transforma o Markdown simples (retornado pelo Gemini) em HTML
        resDiv.innerHTML = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/\*(.*?)\*/g, "<em>$1</em>").replace(/\n/g, "<br>");
    } catch (e) {
        resDiv.innerHTML = "Erro na IA.";
    }
}

// Disparo primário ao abrir a página
init();
