/*
 * Copyright (C) 2025 0J (Lin Jie / 0rigin1856)
 *
 * This file is part of 0riginAttendance-System.
 *
 * 0riginAttendance-System is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * 0riginAttendance-System is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with 0riginAttendance-System.  If not, see <https://www.gnu.org/licenses/>.
 *
 * Please credit "0J (Lin Jie / 0rigin1856)" when redistributing or modifying this project.
 */


// Constants.gs

const LINE_CHANNEL_ID     = PropertiesService.getScriptProperties().getProperty("LINE_CHANNEL_ID");
const LINE_CHANNEL_SECRET = PropertiesService.getScriptProperties().getProperty("LINE_CHANNEL_SECRET");
// 新增你的前端回呼網址
const LINE_REDIRECT_URL   = "https://0rigind1865-bit.github.io/Attendance-System/";

const SHEET_EMPLOYEES = '員工名單';
const SHEET_ATTENDANCE = '打卡紀錄';
const SHEET_SESSION    = 'Session';
const SHEET_LOCATIONS  = '打卡地點表';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24;
const TOKEN_LENGTH   = 36;
