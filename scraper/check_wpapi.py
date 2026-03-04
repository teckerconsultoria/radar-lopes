import httpx
import json

post_id = 18385
base = "https://lopesdeandrade.com.br/wp-json/wp/v2"

endpoints = [
    f"{base}/job-listing/{post_id}",
    f"{base}/job_listing/{post_id}",
    f"{base}/posts/{post_id}",
    f"{base}/",
]

for url in endpoints:
    try:
        r = httpx.get(url, timeout=10, follow_redirects=True)
        print(f"\n[{r.status_code}] {url}")
        if r.status_code == 200:
            data = r.json()
            # Mostra só campos relevantes
            keys_interest = ["date", "modified", "date_gmt", "modified_gmt", "slug", "type", "status"]
            for k in keys_interest:
                if k in data:
                    print(f"  {k}: {data[k]}")
            if "namespaces" in data:
                print(f"  namespaces: {data['namespaces']}")
            if "routes" in data:
                cpt_routes = [r for r in data["routes"] if "job" in r.lower() or "listing" in r.lower()]
                print(f"  rotas CPT: {cpt_routes[:10]}")
        else:
            print(f"  body: {r.text[:200]}")
    except Exception as e:
        print(f"\n[ERRO] {url}: {e}")
