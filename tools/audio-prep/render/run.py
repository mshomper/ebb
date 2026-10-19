import asyncio, sys, base64, struct, wave
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for arg in sys.argv[1:]:
            pg = await b.new_page()
            pg.on('console', lambda m: print('console', m.type, m.text[:200]) if m.type in ('error',) else None)
            pg.on('pageerror', lambda e: print('PAGEERROR', e))
            await pg.goto('http://127.0.0.1:8731/tools/audio-prep/render/index.html?' + arg)
            await pg.wait_for_function("document.getElementById('out').textContent !== 'running'", timeout=170000)
            print(await pg.inner_text('#out'), flush=True)
            if 'wav=' in arg:
                name = [x.split('=')[1] for x in arg.split('&') if x.startswith('wav=')][0]
                b64 = await pg.evaluate("(() => { const u = new Uint8Array(window.__pcm.buffer); let s=''; for (let i=0;i<u.length;i+=0x8000) s += String.fromCharCode.apply(null, u.subarray(i,i+0x8000)); return btoa(s); })()")
                data = base64.b64decode(b64)
                with wave.open(name, 'wb') as w:
                    w.setnchannels(2); w.setsampwidth(2); w.setframerate(48000); w.writeframes(data)
            await pg.close()
        await b.close()
asyncio.run(main())
