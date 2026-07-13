/**
 * 风线动态背景组件
 *
 * 全屏 canvas，固定在 #root 之下（zIndex:-1）。
 * 只在 config.background.type === 'wind' 时挂载（条件渲染）。
 *
 * 与等高线的关键区别：风线有「持久化线条配置」(profiles)。
 * - profiles 只在 totalLines / parallelCount 变化时重建（波形重生成）
 * - fadeIntensity 变化时只重算减淡因子（不动波形，避免跳变）
 * - 其余参数（speed/spread/amplitude/alpha/lineWidth/centerY）只影响绘制
 *
 * 性能策略：与等高线一致（hidden 暂停 + idle 降帧 + resize debounce）。
 */

import React, { useEffect, useRef } from 'react';
import { renderWindFrame, buildLineProfiles, recalcFadeFactors, type LineProfile } from '../../utils/wind';
import { isBgFrozen } from './bgFreeze';
import type { WindParams } from '../../store/skin';

const IDLE_TIMEOUT = 10 * 60 * 1000; // 10 分钟无操作才降帧（切走标签页由 document.hidden 即时暂停）
const IDLE_FRAME_INTERVAL = 1000 / 15;

interface Props {
  params: WindParams;
}

const WindBackground: React.FC<Props> = ({ params }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paramsRef = useRef(params);
  const profilesRef = useRef<LineProfile[]>([]);
  const rafRef = useRef<number | null>(null);
  const timeRef = useRef(0);
  const lastFrameRef = useRef(0);
  const idleRef = useRef(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  paramsRef.current = params;

  // profiles 初始化（挂载时先 build 一次，否则首帧无线条）
  if (profilesRef.current.length === 0) {
    profilesRef.current = buildLineProfiles(params);
  }

  // 监听线条数变化 → 重建波形；fadeIntensity 变化 → 只重算减淡因子
  useEffect(() => {
    profilesRef.current = buildLineProfiles(paramsRef.current);
  }, [params.totalLines, params.parallelCount]);

  useEffect(() => {
    recalcFadeFactors(profilesRef.current, paramsRef.current.fadeIntensity);
  }, [params.fadeIntensity]);

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
    onMouseMove();

    const animate = (now: number) => {
      // 标签页隐藏 / 页面切换动画期间：跳过绘制、只续帧，让玻璃层动画顺滑
      if (document.hidden || isBgFrozen()) {
        rafRef.current = requestAnimationFrame(animate);
        return;
      }
      if (idleRef.current && now - lastFrameRef.current < IDLE_FRAME_INTERVAL) {
        rafRef.current = requestAnimationFrame(animate);
        return;
      }
      lastFrameRef.current = now;

      const w = canvas.width, h = canvas.height;
      if (w > 0 && h > 0) {
        renderWindFrame(ctx, w, h, timeRef.current, paramsRef.current, profilesRef.current);
        timeRef.current += paramsRef.current.speed * 0.00032;
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

export default WindBackground;
