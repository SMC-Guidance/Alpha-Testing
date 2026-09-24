"use strict";
try { if (localStorage.getItem("smc-theme") === "dark") document.documentElement.setAttribute("data-theme", "dark"); } catch (e) {}
document.addEventListener("DOMContentLoaded", function () { var y = document.getElementById("sfYear"); if (y) y.textContent = new Date().getFullYear(); });
