"use strict";
(function(){
  var theme="wood";
  try {
    var saved=localStorage.getItem("smc-theme");
    if (saved === "dark" || saved === "light" || saved === "wood" || saved === "sage" || saved === "sakura") theme=saved;
  } catch(e) {}
  document.documentElement.setAttribute("data-theme",theme);
})();
document.addEventListener("DOMContentLoaded",function(){var y=document.getElementById("sfYear");if(y)y.textContent=new Date().getFullYear();});
