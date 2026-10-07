# Lead Radar

MVP independente para prospecção geográfica de comércios usando Google Maps Platform.

## O que já faz

- mapa interativo com centro selecionável;
- busca por endereço;
- raio de 1 a 20 km;
- filtro por categoria comercial;
- Nearby Search (Places API New);
- pins + lista de estabelecimentos;
- busca de detalhes sob demanda (telefone público, site e avaliações);
- investigação empresarial a partir do site oficial;
- tentativa de localizar CNPJ publicado e consultar quadro societário;
- identificação de sócios/administradores e canais públicos;
- busca web avançada opcional para correlacionar responsável + contato público;
- registro de fonte e nível de confiança do contato;
- seleção de leads;
- exportação CSV;
- deduplicação por Google Place ID no navegador durante a sessão.

> O projeto trabalha apenas com dados publicamente associados à empresa ou ao responsável. Um telefone só é rotulado como contato do responsável quando existe evidência pública relacionando pessoa, empresa e contato; caso contrário ele permanece classificado como contato comercial da empresa.

## Arquitetura

- Frontend: HTML/CSS/JavaScript
- Mapa: Google Maps JavaScript API
- Busca: Places API (New) via funções server-side em /api
- Hospedagem recomendada: Vercel

A chave usada pelo Places Web Service fica somente no servidor. A chave do Maps JavaScript precisa chegar ao navegador e deve ser restrita por HTTP referrer no Google Cloud.

## Configuração

Crie duas chaves no Google Cloud:

1. GOOGLE_MAPS_BROWSER_KEY
   - habilite Maps JavaScript API;
   - habilite Geocoding API para a busca textual;
   - restrinja por HTTP referrer aos seus domínios.

2. GOOGLE_PLACES_SERVER_KEY
   - habilite Places API (New);
   - restrinja a chave à API Places (New).

3. SERPER_API_KEY (opcional)
   - habilita a busca web avançada do módulo de enriquecimento;
   - sem ela, o Lead Radar ainda analisa o site oficial e consulta dados empresariais quando encontra um CNPJ público.

Copie `.env.example` para suas variáveis locais ou configure as mesmas variáveis na Vercel.

## Desenvolvimento

Como a aplicação possui funções em `/api`, a forma mais simples de testar o fluxo completo localmente é com o ambiente de desenvolvimento da Vercel.

Sem as chaves configuradas, a página abre em modo de configuração e não executa consultas pagas.

## Custos

O projeto usa field masks para evitar solicitar campos desnecessários. A busca inicial pede apenas identificação, posição, tipo e endereço. Telefone, site e avaliações são consultados somente quando o usuário pede detalhes de um estabelecimento.

## Limite inicial

O Nearby Search (New) retorna no máximo 20 resultados por chamada. Uma próxima etapa do Lead Radar pode dividir uma área grande em células e consolidar os resultados por Place ID para ampliar a cobertura sem duplicatas.

## Enriquecimento de responsáveis

Fluxo atual: Google Places → site oficial → CNPJ publicado → consulta cadastral direcionada → sócios/administradores → contatos públicos do site → busca web opcional → correlação de fonte/confiança.

A consulta cadastral é feita apenas quando um CNPJ específico é encontrado; o sistema não faz varredura sequencial de CNPJs.

## Próximas etapas

- persistência no Supabase;
- histórico de pesquisas;
- descoberta adicional de e-mail/Instagram comercial publicado;
- lead score;
- listas salvas;
- busca em grade para cobrir áreas maiores;
- autenticação;
- integração futura com LeadOps.
