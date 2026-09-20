# Brasileiros nos EUA por Estado

Dashboard estático (sem build) com a população nascida no Brasil residente em
cada estado dos EUA, de 1990 até o ano mais recente publicado pelo Census
Bureau. Feito para ser hospedado direto no GitHub Pages.

**[Ver o dashboard](./index.html)** · dados em [`data/population.json`](./data/population.json)

## O que tem aqui

- `index.html` + `assets/app.js` — o dashboard (D3 v7 via CDN, sem passo de build).
  Mapa coroplético por estado, gráfico de evolução histórica, ranking com busca
  e ordenação, e comparação de um estado específico contra o total nos EUA.
- `data/population.json` — dataset consolidado (1990–presente, 50 estados + DC).
- `data/us-states-10m.json` — topologia dos estados (via [us-atlas](https://github.com/topojson/us-atlas)), usada pelo mapa.
- `scripts/update-data.mjs` — script Node (sem dependências) que busca o ano
  mais recente da ACS 1-year e atualiza `data/population.json`.
- `.github/workflows/update-data.yml` — roda o script automaticamente toda
  semana entre agosto e outubro (época em que o Census costuma publicar a
  estimativa do ano anterior) e faz commit se houver dado novo.
- `legacy/` — o processo manual original (planilha `.xlsm` com macros e as
  instruções em `Instruction_2026.docx`) que este dashboard substitui.

## Fonte dos dados e metodologia

US Census Bureau, American Community Survey (ACS), Tabela **C05006** (Place of
Birth for the Foreign-Born Population), variável referente ao Brasil.

| Período | Fonte |
|---|---|
| 1990, 2000 | Census decenal (long form) |
| 2001–2004 | Estimativas PUMS |
| 2005 em diante | ACS 1-year estimates |

O Census Bureau não publicou estimativa ACS de 1 ano para **2020** (coleta de
dados interrompida pela pandemia) — o dataset registra esse ano como `null` e
o gráfico mostra o intervalo como uma linha tracejada, nunca como um valor
inventado. As margens de erro da ACS não são exibidas aqui; consulte
[data.census.gov](https://data.census.gov/table/ACSDT1Y2024.C05006) para os
intervalos de confiança de cada estimativa.

O total dos EUA é a soma dos 50 estados + Distrito de Colúmbia (Porto Rico é
excluído, seguindo a mesma convenção da planilha original em `legacy/`).

## Atualizando os dados

```bash
node scripts/update-data.mjs              # tenta o ano seguinte ao mais recente salvo
node scripts/update-data.mjs 2025         # tenta um ano específico
node scripts/update-data.mjs 2025 2026    # tenta um intervalo de anos
```

O script usa o mesmo endpoint público (sem chave de API) que o próprio
data.census.gov usa para exportar tabelas — não depende de credenciais nem de
`api.census.gov`. Um ano ainda não publicado é simplesmente pulado (não é um
erro fatal).

O workflow em `.github/workflows/update-data.yml` roda isso automaticamente;
para forçar uma checagem manual, use a aba **Actions** → *Update Brazilian
population data* → **Run workflow** no GitHub.

## Rodando localmente

Qualquer servidor estático funciona (o dashboard usa `fetch()` para os JSON,
então precisa ser servido via HTTP, não aberto como arquivo local):

```bash
python -m http.server 8000
# ou: npx serve
```

Depois acesse `http://localhost:8000`.

## Publicando no GitHub Pages

1. Suba este repositório para o GitHub.
2. Em **Settings → Pages**, selecione a branch principal e a pasta raiz (`/`).
3. Pronto — `index.html` já referencia tudo por caminho relativo.
