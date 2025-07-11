import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import Polyclinic from "../models/Polyclinic";
import User from "../models/User"; // Menggunakan model User untuk dokter
import Visit from "../models/Visit";
import { generatePolyclinicId } from "../utils/modelHelpers";
import { AuthRequest } from '../middleware/auth';

class PolyclinicController {
  // Get all polyclinics with filtering and pagination
  public async getAllPolyclinics(req: Request, res: Response, next: NextFunction) {
    try {
      const { page = 1, limit = 10, search, department } = req.query;
      const query: any = { isActive: true };
      
      if (search) query.name = { $regex: search as string, $options: "i" };
      if (department) query.department = department;

      const [polyclinics, total] = await Promise.all([
        Polyclinic.find(query)
          .sort({ name: 1 })
          .limit(Number(limit))
          .skip((Number(page) - 1) * Number(limit))
          .lean(),
        Polyclinic.countDocuments(query),
      ]);
      
      const polyclinicsWithStats = await Promise.all(
          polyclinics.map(async (poly: any) => ({ ...poly, stats: await this.getPolyclinicStats(poly._id) }))
      );

      res.json({ success: true, data: polyclinicsWithStats, pagination: { totalPages: Math.ceil(total / Number(limit)), currentPage: Number(page), total } });
    } catch (error) {
      next(error);
    }
  }

  // Get a single polyclinic by ID
  public async getPolyclinicById(req: Request, res: Response, next: NextFunction) {
    try {
      const polyclinic = await Polyclinic.findById(req.params.id).lean();
      if (!polyclinic) {
        return res.status(404).json({ success: false, message: "Poliklinik tidak ditemukan" });
      }
      
      const [stats, doctors] = await Promise.all([
          this.getPolyclinicStats(req.params.id),
          User.find({ role: 'doctor', specialization: polyclinic.name, isActive: true }).select("name").lean()
      ]);

      res.json({ success: true, data: { ...polyclinic, stats, doctors } });
    } catch (error) {
      next(error);
    }
  }

  // Create a new polyclinic
  public async createPolyclinic(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const polyclinicData = { ...req.body, polyclinicId: generatePolyclinicId(), createdBy: req.user?.userId };
      const polyclinic = new Polyclinic(polyclinicData);
      await polyclinic.save();
      res.status(201).json({ success: true, message: "Poliklinik berhasil ditambahkan", data: polyclinic });
    } catch (error: any) {
      if (error.code === 11000) {
        return res.status(400).json({ success: false, message: `Nama atau ID poliklinik sudah digunakan` });
      }
      next(error);
    }
  }

  // Update polyclinic's details
  public async updatePolyclinic(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const updateData = { ...req.body, updatedBy: req.user?.userId, updatedAt: new Date() };
      const polyclinic = await Polyclinic.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true });
      if (!polyclinic) {
        return res.status(404).json({ success: false, message: "Poliklinik tidak ditemukan" });
      }
      res.json({ success: true, message: "Data poliklinik berhasil diperbarui", data: polyclinic });
    } catch (error) {
      next(error);
    }
  }

  // Soft delete a polyclinic
  public async deletePolyclinic(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const updateData = { isActive: false, updatedBy: req.user?.userId, updatedAt: new Date() };
      const polyclinic = await Polyclinic.findByIdAndUpdate(req.params.id, updateData, { new: true });
      if (!polyclinic) {
        return res.status(404).json({ success: false, message: "Poliklinik tidak ditemukan" });
      }
      res.json({ success: true, message: "Poliklinik berhasil dinonaktifkan" });
    } catch (error) {
      next(error);
    }
  }
  
  // Get list of unique departments
  public async getDepartments(req: Request, res: Response, next: NextFunction) {
    try {
        const departments = await Polyclinic.distinct("department", { isActive: true });
        res.json({ success: true, data: departments.filter(Boolean) });
    } catch (error) {
        next(error);
    }
  }
  
  // Helper to get stats for a polyclinic
  private async getPolyclinicStats(polyclinicId: Types.ObjectId | string) {
    try {
        const [monthlyVisits, activeDoctors] = await Promise.all([
            Visit.countDocuments({ polyclinicId, visitDate: { $gte: new Date(new Date().setDate(1)) } }),
            User.countDocuments({ role: 'doctor', polyclinicId, isActive: true }) // Ini mungkin perlu disesuaikan jika dokter tidak langsung terhubung ke poliklinik
        ]);
        return { monthlyVisits, activeDoctors };
    } catch (error) {
        console.error(`Error fetching stats for polyclinic ${polyclinicId}:`, error);
        return { monthlyVisits: 0, activeDoctors: 0 };
    }
  }
}

export default new PolyclinicController();