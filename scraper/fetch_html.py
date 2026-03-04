from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    br = p.chromium.launch(headless=True)
    pg = br.new_page()
    pg.goto(
        "https://lopesdeandrade.com.br/imovel/apartamento-no-primeiro-andar-com-2-quartos-em-mangabeira/",
        wait_until="networkidle"
    )
    with open("pagina_imovel.html", "w", encoding="utf-8") as f:
        f.write(pg.content())
    br.close()

print("Salvo em pagina_imovel.html")
