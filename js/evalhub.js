"use strict";
window.SMC=window.SMC||{};
SMC.evalhub=(function(){
    var active='';
    function q(id){return document.getElementById(id);}
    function activate(name){
        active=name;
        var landing=q('evalHubLanding'),workspace=q('evalHubWorkspace');
        if(landing)landing.hidden=true;
        if(workspace)workspace.hidden=false;
        document.querySelectorAll('[data-eval-panel]').forEach(function(p){p.hidden=p.getAttribute('data-eval-panel')!==name;});
        document.querySelectorAll('[data-eval-tool]').forEach(function(b){b.classList.toggle('on',b.getAttribute('data-eval-tool')===name);b.setAttribute('aria-selected',b.getAttribute('data-eval-tool')===name?'true':'false');});
        var title=q('evalHubCurrentTitle'),sub=q('evalHubCurrentSub');
        if(title)title.textContent=name==='k2'?'K2 Paper Evaluation':'Online Evaluation Workbooks';
        if(sub)sub.textContent=name==='k2'?'Encode paper responses, save one batch, then create the PDF and result workbook.':'Preview source forms and build grade-level workbooks from Google Drive.';
        if(name==='k2'){
            var body=q('k2Body'),toggle=q('k2Collapse');
            if(body&&body.hidden&&toggle)toggle.click();
        }
    }
    function home(){active='';var landing=q('evalHubLanding'),workspace=q('evalHubWorkspace');if(landing)landing.hidden=false;if(workspace)workspace.hidden=true;}
    function mount(){
        var hub=q('evalHub');if(!hub||hub.getAttribute('data-wired')==='1')return !!hub;
        hub.setAttribute('data-wired','1');
        document.querySelectorAll('[data-eval-open]').forEach(function(b){b.onclick=function(){activate(b.getAttribute('data-eval-open'));};});
        document.querySelectorAll('[data-eval-tool]').forEach(function(b){b.onclick=function(){activate(b.getAttribute('data-eval-tool'));};});
        var back=q('evalHubBack');if(back)back.onclick=home;
        home();return true;
    }
    return{mount:mount,activate:activate,home:home};
})();
