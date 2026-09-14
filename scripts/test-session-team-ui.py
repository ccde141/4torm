"""Isolated UI smoke test. Requires Vite on 5173 and Python Playwright; no real API calls."""
import json
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

HTML = '''<html><head><meta charset="utf-8"><style>
:root { --color-bg-secondary:#18191c; --color-bg-tertiary:#25262b;
--color-border:#ffffff25; --color-text-primary:#f1f1f3; --color-text-secondary:#a5a5ae; }
body { background:#101114; font-family:system-ui; color:#eee; }
</style></head><body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type;
window.__vite_plugin_react_preamble_installed__=true;
const {default:React}=await import('/node_modules/.vite/deps/react.js');
const {default:ReactDOM}=await import('/node_modules/.vite/deps/react-dom_client.js');
const {LocaleProvider}=await import('/src/i18n/LocaleContext.tsx');
const {default:TeamView}=await import('/src/components/chat/team/TeamView.tsx');
const root=ReactDOM.createRoot(document.getElementById('root'));
window.renderTeam=(sessionId='fixture')=>root.render(React.createElement(LocaleProvider,null,
React.createElement(TeamView,{key:sessionId,agentId:'fixture',sessionId,mainName:'项目助理',mainBusy:false})));
window.renderTeam();
</script></body></html>'''

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1360, "height": 900})
    errors, requests = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    names = ['需求研究', '实现开发', '质量审查', '文档整理']
    statuses = ['completed', 'running', 'failed', 'idle']
    members = [{"id": str(i), "name": name, "mission": '核查证据并向主 Agent 提交工作成果',
                "rolePrompt": '以实际证据为准', "taskContext": '示例项目', "constraints": '只在指定工作区操作',
                "lifecycle": 'active', **({"run": {"id": str(i), "task": '检查接口与边界', "status": statuses[i]}} if i < 3 else {})}
               for i, name in enumerate(names)]
    reports = [{"id": 'r1', "memberId": '0', "task": '检查接口与边界', "outcome": 'completed',
                "content": '已核查三个接口。\n发现一个需要主 Agent 决策的权限边界。', "acknowledged": False}]

    def route(request):
        url = request.request.url
        if '/__team-preview' in url:
            request.fulfill(content_type='text/html', body=HTML)
        elif '/api/' in url:
            requests.append(request.request.method)
            request.fulfill(content_type='application/json', body=json.dumps({"revision": 1, "members": members, "reports": reports}))
        else:
            request.continue_()

    page.route('**/*', route)
    page.goto('http://localhost:5173/__team-preview')
    page.wait_for_load_state('networkidle')
    assert not errors, errors
    page.get_by_role('button', name='工作队').click()
    expect(page.get_by_role('dialog')).to_be_visible()
    page.get_by_role('button', name='需求研究').click()
    expect(page.get_by_text('待主 Agent 收取')).to_be_visible()
    screenshot = str(Path(tempfile.gettempdir()) / '4torm-team-preview.png')
    page.screenshot(path=screenshot)
    page.keyboard.press('Escape')
    expect(page.get_by_role('dialog')).to_have_count(0)
    page.get_by_role('button', name='工作队').click()
    page.evaluate("window.renderTeam('other')")
    expect(page.get_by_role('dialog')).to_have_count(0)
    page.set_viewport_size({"width": 600, "height": 800})
    page.get_by_role('button', name='工作队').click()
    expect(page.get_by_role('dialog')).to_be_visible()
    assert page.locator('dialog').evaluate('(el) => el.scrollWidth <= el.clientWidth')
    assert not errors, errors
    assert all(method == 'GET' for method in requests), requests
    browser.close()
    print('PASS: member details, Escape, owner switch, read-only requests; screenshot ' + screenshot)
