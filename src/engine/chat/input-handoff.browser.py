"""Run against an isolated Vite server; the fixture mocks every API in memory."""
from playwright.sync_api import sync_playwright, expect

BASE = 'http://127.0.0.1:5179/src/engine/chat/input-handoff.browser.html'


def open_case(browser, mode):
    context = browser.new_context()
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(f'{BASE}?mode={mode}')
    page.wait_for_load_state('networkidle')
    expect(page.get_by_role('button', name='Send', exact=True)).to_be_enabled()
    return context, page, errors


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for mode in ['closed', 'received', 'included', 'uncertain']:
        context, page, errors = open_case(browser, mode)
        page.get_by_role('button', name='Send', exact=True).click()
        expect(page.locator('.chat__human-input-status').last).to_have_text('等待下一轮' if mode == 'closed' else '已接收 · 等待本次模型响应')
        expect(page.locator('.chat__message--steering')).to_have_count(1)
        expect(page.locator('.chat__input-area')).to_have_count(0)
        expect(page.get_by_role('button', name='核对接收状态并继续')).to_have_count(0)
        expect(page.get_by_role('button', name='Send', exact=True)).to_be_enabled()
        expect(page.locator('output')).to_contain_text('chats=0')
        page.get_by_role('button', name='Finish', exact=True).click()
        if mode != 'included':
            expect(page.get_by_text('new answer 1', exact=True)).to_be_visible()
            expect(page.locator('output')).to_contain_text('chats=1')
        else:
            expect(page.locator('output')).to_contain_text('streaming=false')
            expect(page.locator('.chat__human-input-status')).to_have_text('已纳入上下文')
            expect(page.get_by_role('button', name='核对接收状态并继续')).to_have_count(0)
        expect(page.locator('output')).to_contain_text('posts=1')
        assert not errors, errors
        context.close()
        print(f'PASS: {mode}')

    context, page, errors = open_case(browser, 'included')
    page.get_by_role('button', name='Send', exact=True).click()
    for button, status in [
        ('Model output', '已接收 · 等待本次模型响应'),
        ('Tool arguments', '已接收 · 等待本次模型响应'),
        ('Tool execution', '已接收 · 等待当前工具结束'),
        ('Team waiting', '已接收 · 等待主 Agent 继续'),
        ('Compact', '已接收 · 等待压缩结束'),
        ('Compacted', '已接收 · 等待主 Agent 继续'),
    ]:
        page.get_by_role('button', name=button, exact=True).click()
        expect(page.locator('.chat__human-input-status')).to_have_text(status)
        expect(page.locator('.chat__message--steering')).to_have_count(1)
        expect(page.locator('output')).to_contain_text('chats=0 | posts=1')
    page.get_by_role('button', name='Finish', exact=True).click()
    expect(page.locator('.chat__human-input-status')).to_have_text('已纳入上下文')
    assert not errors, errors
    context.close()
    print('PASS: wait hints follow model, tools, team and compaction without restarting work')

    context, page, errors = open_case(browser, 'reordered')
    page.get_by_role('button', name='Send', exact=True).click()
    expect(page.get_by_role('button', name='Send', exact=True)).to_be_enabled()
    page.get_by_role('textbox', name='Message').fill('second correction')
    page.get_by_role('button', name='Send', exact=True).click()
    expect(page.locator('output')).to_contain_text('posts=2')
    page.get_by_role('button', name='Finish', exact=True).click()
    expect(page.get_by_text('new answer 2', exact=True)).to_be_visible()
    expect(page.locator('output')).to_contain_text('chats=2')
    paragraphs = page.locator('p').all_text_contents()
    assert paragraphs.index('first correction') < paragraphs.index('second correction'), paragraphs
    assert not errors, errors
    context.close()
    print('PASS: two consecutive inputs')

    context, page, errors = open_case(browser, 'closed')
    page.get_by_role('button', name='Send', exact=True).click()
    page.get_by_role('button', name='Stop', exact=True).click()
    expect(page.get_by_role('button', name='核对接收状态并继续')).to_be_visible()
    expect(page.locator('output')).to_contain_text('chats=0')
    page.reload()
    page.wait_for_load_state('networkidle')
    expect(page.locator('.chat__message--steering').filter(has_text='first correction')).to_be_visible()
    expect(page.locator('.chat__input-area')).to_have_count(0)
    expect(page.locator('output')).to_contain_text('posts=0')
    assert not errors, errors
    context.close()
    print('PASS: stop and reload retain input without replay')
    context, page, errors = open_case(browser, 'closed')
    page.get_by_role('button', name='Send', exact=True).click()
    page.get_by_role('button', name='Switch', exact=True).click()
    expect(page.locator('output')).to_contain_text('agent-test-other')
    page.get_by_role('button', name='Finish', exact=True).click()
    page.wait_for_function("!localStorage.getItem('conversation.input.pending.agent-test-session')")
    expect(page.get_by_text('new answer 1', exact=True)).not_to_be_visible()
    assert not errors, errors
    context.close()
    print('PASS: background handoff does not overwrite the active conversation')
    browser.close()
