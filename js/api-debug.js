/**
 * API 诊断工具
 * 用于测试后端连接和调试 API 问题
 */

async function testBackendConnection() {
    console.log('🧪 开始测试后端连接...');

    const apiUrl = "https://script.google.com/macros/s/AKfycby28KblKy-ICEGstB7L-UK5rQ1awPokRiIIdqpJ49_7nVmS_oHYiA9qapWtOVo_UnEHbQ/exec";

    try {
        // 测试 1: 简单 GET 请求
        console.log('📡 测试 1: GET 请求（无参数）');
        const res1 = await fetch(apiUrl, {
            method: 'GET',
            mode: 'cors',
        });
        console.log('✅ GET 请求成功，状态码:', res1.status);
        const text1 = await res1.text();
        console.log('响应内容:', text1.substring(0, 200));
    } catch (err) {
        console.error('❌ GET 请求失败:', err.message);
    }

    try {
        // 测试 2: POST 请求（带参数）
        console.log('\n📡 测试 2: POST 请求（带参数）');
        const params = new URLSearchParams({
            action: 'checkSession',
            token: localStorage.getItem('sessionToken') || 'test_token'
        });

        const res2 = await fetch(apiUrl, {
            method: 'POST',
            mode: 'cors',
            body: params.toString(),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        console.log('✅ POST 请求成功，状态码:', res2.status);
        const text2 = await res2.text();
        console.log('响应内容:', text2.substring(0, 200));
    } catch (err) {
        console.error('❌ POST 请求失败:', err.message);
    }
}

// 在页面加载时自动诊断（可选）
// document.addEventListener('DOMContentLoaded', () => {
//     console.log('页面已加载，可以手动运行: testBackendConnection()');
// });

console.log('✓ API 诊断工具已加载。使用 testBackendConnection() 来测试后端连接');
