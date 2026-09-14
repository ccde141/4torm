"""Browser SSE abort regression; all network calls use fixtures, no model access."""
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.route('**/__retention', lambda route: route.fulfill(content_type='text/html', body='<meta charset="utf-8">'))
    page.goto('http://localhost:5173/__retention')
    result = page.evaluate('''async () => {
      const {runStreamLoop} = await import('/src/engine/chat/streamLoop.ts');
      const originalFetch = window.fetch;
      const abortController = new AbortController();
      let visible = [], saved;
      window.fetch = async () => new Response(new ReadableStream({start(controller) {
        const events = [
          {type:'reasoning',content:'before'},
          {type:'tool-call',tool:'read_file',args:{path:'a'}},
          {type:'tool-result',result:'evidence',ok:true},
          {type:'reasoning',content:'after'}, {type:'token',content:'tail'},
        ];
        controller.enqueue(new TextEncoder().encode(events.map(e=>'data: '+JSON.stringify(e)+'\\n\\n').join('')));
        setTimeout(()=>{abortController.abort();controller.error(new DOMException('Stopped','AbortError'));},10);
      }}));
      try {
        await runStreamLoop({session:{id:'session',title:'title',messages:[]},agent:{id:'agent'},
          allMessages:[],chatMessages:[],providerInfo:{baseUrl:'',apiKey:'',signal:abortController.signal},
          modelId:'',toolDefs:[],selectedModel:'',abortController,
          setMessages:m=>{visible=m},saveSessionFn:async s=>{saved=s},
          refreshSessions:()=>{},generateMessageIdFn:()=>'reply'});
        return {visible,saved};
      } finally {window.fetch=originalFetch;}
    }''')
    message = result['visible'][0]
    assert message['content'] == 'tail'
    assert message['reasoningContent'] == 'beforeafter'
    assert message['reasoningBreaks'] == [6]
    assert message['toolSteps'][0]['result'] == 'evidence'
    assert result['saved']['messages'] == result['visible']
    assert message['streamStopped'] is True
    page.evaluate('''async () => {
      const {default:refresh}=await import('/@react-refresh');
      refresh.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>t=>t;
      window.__vite_plugin_react_preamble_installed__=true;
      const {default:React}=await import('/node_modules/.vite/deps/react.js');
      const {default:DOM}=await import('/node_modules/.vite/deps/react-dom_client.js');
      const {LocaleProvider}=await import('/src/i18n/LocaleContext.tsx');
      const {default:Process}=await import('/src/components/chat/TurnProcess.tsx');
      const {default:Reasoning}=await import('/src/components/chat/ReasoningBlock.tsx');
      const container=document.createElement('div');document.body.append(container);
      DOM.createRoot(container).render(React.createElement(LocaleProvider,null,
        React.createElement(Process,{kind:'reasoning',present:true},
          React.createElement('div',{style:{height:900}},React.createElement(Reasoning,{reasoning:'beforeafter',breaks:[6],isStreaming:true}))),
        React.createElement(Process,{kind:'tools',present:true},React.createElement('div',{style:{height:900}},'tool records'))));
    }''')
    page.wait_for_selector('.turn-process-body')
    regions = page.locator('.turn-process-body')
    assert regions.count() == 2
    assert regions.nth(0).evaluate('(el)=>el.clientHeight') <= 360
    assert regions.nth(1).evaluate('(el)=>el.clientHeight') <= 360
    expect(regions.nth(0)).to_have_attribute('data-fade-top', 'false')
    expect(regions.nth(0)).to_have_attribute('data-fade-bottom', 'true')
    regions.nth(0).evaluate('(el)=>el.scrollTop=150')
    expect(regions.nth(0)).to_have_attribute('data-fade-top', 'true')
    assert regions.nth(1).evaluate('(el)=>el.scrollTop') == 0
    assert page.locator('.turn-process-reasoning-divider').count() == 1
    regions.nth(0).evaluate('(el)=>el.scrollTop=el.scrollHeight')
    expect(regions.nth(0)).to_have_attribute('data-fade-bottom', 'false')
    page.evaluate('''async () => {
      const {default:React}=await import('/node_modules/.vite/deps/react.js');
      const {default:DOM}=await import('/node_modules/.vite/deps/react-dom_client.js');
      const {LocaleProvider}=await import('/src/i18n/LocaleContext.tsx');
      const {default:Process}=await import('/src/components/chat/TurnProcess.tsx');
      const host=document.createElement('div');host.id='follow-test';document.body.append(host);
      DOM.createRoot(host).render(React.createElement(LocaleProvider,null,
        React.createElement(Process,{kind:'reasoning',present:true,followLatest:true},
          React.createElement('div',{id:'growing-reasoning',style:{height:900}},'streaming'))));
    }''')
    follower = page.locator('#follow-test .turn-process-body')
    expect(follower).to_have_attribute('data-fade-bottom', 'false')
    page.evaluate("document.getElementById('growing-reasoning').style.height='1200px'")
    page.wait_for_function("(()=>{const e=document.querySelector('#follow-test .turn-process-body');return e.scrollTop>800 && e.scrollHeight-e.clientHeight-e.scrollTop<2})()")
    follower.evaluate('(el)=>el.scrollTop=150')
    expect(follower).to_have_attribute('data-fade-bottom', 'true')
    page.evaluate("document.getElementById('growing-reasoning').style.height='1500px'")
    page.wait_for_function("document.querySelector('#follow-test .turn-process-body').scrollHeight>=1500")
    assert follower.evaluate('(el)=>el.scrollTop') == 150
    follower.evaluate('(el)=>el.scrollTop=el.scrollHeight')
    expect(follower).to_have_attribute('data-fade-bottom', 'false')
    page.evaluate("document.getElementById('growing-reasoning').style.height='1800px'")
    page.wait_for_function("(()=>{const e=document.querySelector('#follow-test .turn-process-body');return e.scrollTop>1400 && e.scrollHeight-e.clientHeight-e.scrollTop<2})()")
    page.locator('.turn-process-toolbar button').first.click()
    assert regions.nth(0).evaluate('(el)=>el.clientHeight') >= 900
    assert regions.nth(1).evaluate('(el)=>el.clientHeight') <= 360
    expect(regions.nth(0)).to_have_attribute('data-fade-top', 'false')
    expect(regions.nth(0)).to_have_attribute('data-fade-bottom', 'false')
    page.evaluate('''async () => {
      const {default:React}=await import('/node_modules/.vite/deps/react.js');
      const {default:DOM}=await import('/node_modules/.vite/deps/react-dom_client.js');
      const {LocaleProvider}=await import('/src/i18n/LocaleContext.tsx');
      const {default:Phase}=await import('/src/components/chat/LivePhase.tsx');
      const host=document.createElement('div');host.id='phase-test';document.body.append(host);
      const root=DOM.createRoot(host);
      window.renderPhase=(phase,elapsed)=>root.render(React.createElement(LocaleProvider,null,React.createElement(Phase,{phase,elapsed})));
      window.renderPhase('llm-waiting',0);
    }''')
    expect(page.locator('#phase-test')).to_contain_text('1s', timeout=4000)
    page.evaluate("window.renderPhase('tool-exec',10)")
    expect(page.locator('#phase-test')).to_contain_text('11s', timeout=4000)
    page.evaluate("window.renderPhase('llm-waiting',0)")
    expect(page.locator('#phase-test')).not_to_contain_text('11s')
    browser.close()
    print('PASS: abort retention; independent reasoning/tool scrolling and expansion; observation divider')
