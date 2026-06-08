/**
 * 等高线动态背景组件
 *
 * 全屏 canvas，作为 body 的兄弟节点固定在 #root 之前。
 * 只在 config.background.type === 'contour' 时挂载（条件渲染）。
 *
 * 性能策略：
 * - document.hidden 时暂停 raf
 * - 鼠标静止 IDLE_TIMEOUT 后降帧到 IDLE_FPS
 * - canvas 尺寸跟随 window resize（debounced）
 * - 卸载时 cancel raf 释放
 */

import React, { useEffect, useRef } from 'react';
import { renderContourFrame } from '../../utils/contour';
import type { ContourParams } from '../../store/skin';

const IDLE_TIMEOUT = 10 * 60 * 1000;       // 600s 无鼠标移动 → 降帧
const IDLE_FRAME_INTERVAL = 1000 / 15;  // idle 时 15fps

interface Props {
  params: ContourParams;
}

const ContourBackground: React.FC<Props> = ({ params }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paramsRef = useRef(params);
  const rafRef = useRef<number | null>(null);
  const timeRef = useRef(0);
  const lastFrameRef = useRef(0);
  const idleRef = useRef(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 让 ref 始终持有最新参数（避免重启 raf 循环）
  paramsRef.current = params;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 60);
    };
    window.addEventListener('resize', onResize);

    const onMouseMove = () => {
      idleRef.current = false;
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => { idleRef.current = true; }, IDLE_TIMEOUT);
    };
    window.addEventListener('mousemove', onMouseMove);
    onMouseMove(); // 启动 idle 计时

    const animate = (now: number) => {
      if (document.hidden) {
        // 标签页隐藏时暂停，但保持 raf 注册（resume on visible）
        rafRef.current = requestAnimationFrame(animate);
        return;
      }

      // idle 时降帧
      if (idleRef.current) {
        if (now - lastFrameRef.current < IDLE_FRAME_INTERVAL) {
          rafRef.current = requestAnimationFrame(animate);
          return;
        }
      }
      lastFrameRef.current = now;

      const w = canvas.width, h = canvas.height;
      if (w > 0 && h > 0) {
        renderContourFrame(ctx, w, h, timeRef.current, paramsRef.current);
        timeRef.current += paramsRef.current.speed * 0.00035;
      }
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: -1,
        pointerEvents: 'none',
      }}
      aria-hidden
    />
  );
};

export default ContourBackground;
