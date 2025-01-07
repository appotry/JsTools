// ==UserScript==
// @name         markdown整理
// @namespace    https://blog.17lai.site
// @version      1.0.1
// @description  去掉影响 markdown 复制编辑的元素
// @author       夜法之书
// @license      GPL V3
// @include      http://*
// @include      https://*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=17lai.site
// @grant        none
// @run-at       document-end
// @updateURL   https://raw.githubusercontent.com/appotry/JsTools/main/forWriter/md.js
// @downloadURL https://raw.githubusercontent.com/appotry/JsTools/main/forWriter/md.js
// ==/UserScript==

(function() {
    'use strict';
    // 创建悬浮图标
    var floatingIcon = document.createElement('div');
    floatingIcon.style.position = 'fixed';
    floatingIcon.style.top = '190px';
    floatingIcon.style.right = '20px';
    floatingIcon.style.width = '50px';
    floatingIcon.style.height = '50px';
    floatingIcon.style.background = 'green';
    floatingIcon.style.borderRadius = '50%';
    floatingIcon.style.cursor = 'pointer';
    floatingIcon.style.zIndex = '9999';
    floatingIcon.title = 'Replace Links';
    floatingIcon.innerHTML = '<span style="display: block; width: 100%; height: 100%; line-height: 50px; text-align: center; color: white;">🔗</span>';

    // 将悬浮图标添加到页面中
    document.body.appendChild(floatingIcon);

    // 记录鼠标相对于图标的偏移量
    var offsetX, offsetY;

    // 当鼠标按下时
    floatingIcon.addEventListener('mousedown', function(e) {
        // 计算鼠标相对于图标的偏移量
        offsetX = e.clientX - floatingIcon.getBoundingClientRect().left;
        offsetY = e.clientY - floatingIcon.getBoundingClientRect().top;

        // 添加鼠标移动和松开事件监听器
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    // 当鼠标移动时
    function onMouseMove(e) {
        // 计算图标的新位置
        var newX = e.clientX - offsetX;
        var newY = e.clientY - offsetY;

        // 更新图标的位置
        floatingIcon.style.left = newX + 'px';
        floatingIcon.style.top = newY + 'px';
    }

    // 当鼠标松开时
    function onMouseUp() {
        // 移除鼠标移动和松开事件监听器
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }

    // 点击悬浮图标时运行 replaceLinks 函数
    floatingIcon.addEventListener('click', function() {
        removeNotionHeaderAnchors();
        hideCodeLangElements();
    });

    function removeNotionHeaderAnchors() {
        // 查找页面中所有具有 class 为 'notion-header-anchor' 的 <a> 标签
        var anchors = document.querySelectorAll('a.notion-header-anchor, a.notion-hash-link');

        // 遍历所有符合条件的 <a> 标签
        for (var i = 0; i < anchors.length; i++) {
            // 获取当前 <a> 标签的父元素
            var parentElement = anchors[i].parentNode;

            // 将 <a> 标签的子元素（如果有的话）插入到父元素中
            while (anchors[i].firstChild) {
                parentElement.insertBefore(anchors[i].firstChild, anchors[i]);
            }

            // 移除当前 <a> 标签
            parentElement.removeChild(anchors[i]);
        }
    }

    // 隐藏 .code_lang 元素 。 theme hexo matery
    function hideCodeLangElements() {
        var codeLangElements = document.querySelectorAll('.code_lang');
        for (var i = 0; i < codeLangElements.length; i++) {
            codeLangElements[i].style.display = 'none';
        }
    }

})();
