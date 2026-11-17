/**
 * 程序化兜底模型
 * -------------------------------------------------------------
 * 当远程 GLTF/GLB 不可用时（网络受限、地址未配置），用 three 基本几何体
 * 搭建一台教学用旋转咖啡杯样机，保证：
 *  1. 节点命名与《模型制作规范.md》的约定完全一致，PartRegistry 可正常识别
 *  2. 运动层级与正式模型一致：大转盘 -> 杯位（公转），杯根节点自转
 *  3. 摩擦轮摆臂具备真实铰接层级，可演示角度限位
 *
 * 层级结构：
 *  base_frame（底座）
 *   ├─ main_motor_0（主电机 + 小齿轮）
 *   ├─ slewing_bearing_0（回转支承齿圈）
 *   └─ main_turntable_0（大转盘，旋转节点）
 *        ├─ slip_ring_0（中心滑环）
 *        └─ 杯位 i（i=0..5，均布在半径 R 的圆周上）
 *             ├─ friction_wheel_i（摆臂 + 摩擦轮，铰接节点）
 *             ├─ cup_drive_i（独立驱动电机）
 *             └─ coffee_cup_i（杯体根节点，自转节点）
 */
import * as THREE from 'three';

/** 杯位数量与分布半径（场景单位，归一化后约 6 的整机尺度） */
const CUP_COUNT = 6;
const ORBIT_RADIUS = 2.1;

export class ProceduralModel {
  /** 构建完整样机，返回模型根节点 */
  static build() {
    const root = new THREE.Group();
    root.name = 'coffee_cup_machine_procedural';

    const mat = ProceduralModel._materials();

    root.add(ProceduralModel._buildBase(mat));
    root.add(ProceduralModel._buildMotor(mat));
    root.add(ProceduralModel._buildBearing(mat));

    const turntable = ProceduralModel._buildTurntable(mat);
    root.add(turntable);

    // 中心滑环挂在转盘中心（随转盘旋转，符合真实安装关系）
    turntable.add(ProceduralModel._buildSlipRing(mat));

    // 六个杯位均布
    for (let i = 0; i < CUP_COUNT; i++) {
      const angle = (i / CUP_COUNT) * Math.PI * 2;
      const x = Math.cos(angle) * ORBIT_RADIUS;
      const z = Math.sin(angle) * ORBIT_RADIUS;

      turntable.add(ProceduralModel._buildFrictionWheel(i, x, z, angle, mat));
      turntable.add(ProceduralModel._buildCupDrive(i, x, z, mat));
      turntable.add(ProceduralModel._buildCoffeeCup(i, x, z, mat));
    }

    root.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    return root;
  }

  /** 教学配色：不同功能部件用区分度高的颜色 */
  static _materials() {
    return {
      frame: new THREE.MeshStandardMaterial({ color: 0x3b4658, metalness: 0.65, roughness: 0.45 }),
      motor: new THREE.MeshStandardMaterial({ color: 0x2f7d6d, metalness: 0.4, roughness: 0.5 }),
      gear: new THREE.MeshStandardMaterial({ color: 0x9aa7b8, metalness: 0.85, roughness: 0.3 }),
      bearing: new THREE.MeshStandardMaterial({ color: 0x7c8aa0, metalness: 0.9, roughness: 0.25 }),
      disk: new THREE.MeshStandardMaterial({ color: 0x46536b, metalness: 0.55, roughness: 0.4 }),
      wheel: new THREE.MeshStandardMaterial({ color: 0xd9822b, metalness: 0.1, roughness: 0.75 }), // 聚氨酯包胶轮
      arm: new THREE.MeshStandardMaterial({ color: 0x8a93a3, metalness: 0.7, roughness: 0.35 }),
      cup: new THREE.MeshStandardMaterial({ color: 0xc9534f, metalness: 0.15, roughness: 0.35 }),
      cupInner: new THREE.MeshStandardMaterial({ color: 0xf3e2c4, metalness: 0.05, roughness: 0.6 }),
      drive: new THREE.MeshStandardMaterial({ color: 0x5b8fd9, metalness: 0.45, roughness: 0.45 }),
      ring: new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.2 })
    };
  }

  /** 主机底座：圆筒基座 + 顶部法兰 */
  static _buildBase(mat) {
    const group = new THREE.Group();
    group.name = 'base_frame_0';

    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(2.75, 2.95, 0.5, 48), mat.frame);
    pedestal.name = 'base_frame_pedestal';
    pedestal.position.y = 0.25;

    const flange = new THREE.Mesh(new THREE.CylinderGeometry(2.55, 2.55, 0.16, 48), mat.frame);
    flange.name = 'base_frame_flange';
    flange.position.y = 0.58;

    // 四个减振脚杯
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.12, 20), mat.gear);
      foot.name = `base_frame_foot_${i}`;
      foot.position.set(Math.cos(a) * 2.3, 0.06, Math.sin(a) * 2.3);
      group.add(foot);
    }
    group.add(pedestal, flange);
    return group;
  }

  /** 主驱动电机：电机箱体 + 输出小齿轮 */
  static _buildMotor(mat) {
    const group = new THREE.Group();
    group.name = 'main_motor_0';
    group.position.set(1.7, 0.62, 0);

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.42, 0.62), mat.motor);
    body.name = 'main_motor_body';

    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 16), mat.gear);
    shaft.name = 'main_motor_shaft';
    shaft.rotation.z = Math.PI / 2;
    shaft.position.x = 0.42;

    const pinion = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.1, 24), mat.gear);
    pinion.name = 'main_motor_pinion_gear';
    pinion.rotation.z = Math.PI / 2;
    pinion.position.x = 0.66;

    group.add(body, shaft, pinion);
    return group;
  }

  /** 回转支承：固定外圈（齿圈）+ 内圈示意 */
  static _buildBearing(mat) {
    const group = new THREE.Group();
    group.name = 'slewing_bearing_0';

    const outer = new THREE.Mesh(new THREE.TorusGeometry(2.25, 0.14, 16, 64), mat.bearing);
    outer.name = 'slewing_bearing_outer_gear_ring';
    outer.rotation.x = Math.PI / 2;
    outer.position.y = 0.72;

    const inner = new THREE.Mesh(new THREE.TorusGeometry(1.95, 0.08, 12, 64), mat.gear);
    inner.name = 'slewing_bearing_inner_ring';
    inner.rotation.x = Math.PI / 2;
    inner.position.y = 0.72;

    group.add(outer, inner);
    return group;
  }

  /** 旋转大转盘：盘面 + 围栏，整体作为公转旋转节点 */
  static _buildTurntable(mat) {
    const group = new THREE.Group();
    group.name = 'main_turntable_0';
    group.position.y = 0.78;

    const disk = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.14, 64), mat.disk);
    disk.name = 'main_turntable_disk';
    disk.position.y = 0;

    // 外圈安全围栏
    const rail = new THREE.Mesh(new THREE.TorusGeometry(2.52, 0.035, 10, 64), mat.arm);
    rail.name = 'main_turntable_safety_rail';
    rail.rotation.x = Math.PI / 2;
    rail.position.y = 0.42;

    group.add(disk, rail);
    return group;
  }

  /** 中心导电滑环 */
  static _buildSlipRing(mat) {
    const group = new THREE.Group();
    group.name = 'slip_ring_0';

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.5, 24), mat.ring);
    body.name = 'slip_ring_body';
    body.position.y = 0.36;

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.06, 24), mat.gear);
    cap.name = 'slip_ring_cap';
    cap.position.y = 0.64;

    group.add(body, cap);
    return group;
  }

  /**
   * 摩擦轮组件：摆臂铰接在杯位旁，轮缘压向杯底盘
   * 约定摆臂绕自身局部 Z 轴摆动，仿真角度限位作用于该轴
   */
  static _buildFrictionWheel(index, x, z, angle, mat) {
    const pivot = new THREE.Group();
    pivot.name = `friction_wheel_${index}`;
    // 铰点位于杯心朝向转盘中心一侧
    pivot.position.set(x - Math.cos(angle) * 0.42, 0.1, z - Math.sin(angle) * 0.42);
    // 让局部 Z 轴成为切向铰链轴
    pivot.rotation.y = -angle;

    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.07, 0.1), mat.arm);
    arm.name = `friction_wheel_${index}_swing_arm`;
    arm.position.x = 0.22;

    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 28), mat.wheel);
    wheel.name = `friction_wheel_${index}_polyurethane_wheel`;
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(0.48, 0.02, 0);

    const spring = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 10), mat.ring);
    spring.name = `friction_wheel_${index}_pressure_spring`;
    spring.rotation.z = Math.PI / 2;
    spring.position.set(0.05, -0.12, 0);

    pivot.add(arm, wheel, spring);
    return pivot;
  }

  /** 杯体独立驱动电机（位于杯位下方） */
  static _buildCupDrive(index, x, z, mat) {
    const group = new THREE.Group();
    group.name = `cup_drive_${index}`;
    group.position.set(x, 0.12, z);

    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.22, 24), mat.drive);
    motor.name = `cup_drive_${index}_servo_motor`;

    const coupling = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 12), mat.gear);
    coupling.name = `cup_drive_${index}_coupling`;
    coupling.position.y = 0.17;

    group.add(motor, coupling);
    return group;
  }

  /** 咖啡杯座舱：杯体根节点即自转节点，仿真直接驱动其 rotation.y */
  static _buildCoffeeCup(index, x, z, mat) {
    const group = new THREE.Group();
    group.name = `coffee_cup_${index}`;
    group.position.set(x, 0.08, z);

    // 杯底盘（摩擦轮压紧面）
    const saucer = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 36), mat.gear);
    saucer.name = `coffee_cup_${index}_base_disk`;
    saucer.position.y = 0.04;

    // 杯身：上宽下窄圆筒，模拟咖啡杯轮廓
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.26, 0.55, 36, 1, true), mat.cup);
    body.name = `coffee_cup_${index}_body`;
    body.position.y = 0.35;

    // 杯体内衬
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.23, 0.5, 36, 1, true), mat.cupInner);
    inner.name = `coffee_cup_${index}_inner`;
    inner.position.y = 0.36;

    // 杯把（圆环）
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.035, 12, 24), mat.cup);
    handle.name = `coffee_cup_${index}_handle`;
    handle.position.set(0.38, 0.38, 0);
    handle.rotation.y = Math.PI / 2;

    // 坐凳示意
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 24), mat.cupInner);
    seat.name = `coffee_cup_${index}_seat`;
    seat.position.y = 0.22;

    group.add(saucer, body, inner, handle, seat);
    return group;
  }
}
