/* Reusable GSAP entrance for one scene. Caller owns the timeline and duration.
   Keep CSS as the final visible state. Use the project's saved motion settings. */
function yingyaStyleEntrance(timeline, scene, motion, at = 0) {
  const options = { duration: motion.enter, ease: motion.ease, immediateRender: false };
  timeline.from(scene.querySelector('.ys-eyebrow'), { ...options, opacity: 0, y: motion.distance / 2 }, at);
  timeline.from(scene.querySelector('.ys-title'), { ...options, opacity: 0, y: motion.distance }, at + .15);
  timeline.from(scene.querySelector('.ys-subtitle'), { ...options, opacity: 0, y: motion.distance / 2 }, at + .4);
  timeline.from(scene.querySelectorAll('.ys-step'), { ...options, opacity: 0, y: motion.distance, stagger: motion.stagger }, at + .65);
  timeline.from(scene.querySelector('.ys-footer'), { ...options, opacity: 0 }, at + 1.2);
  return timeline;
}
