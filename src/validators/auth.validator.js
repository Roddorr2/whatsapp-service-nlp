import { body, validationResult } from 'express-validator';

export const validateLogin = [
  body('username')
    .notEmpty()
    .withMessage('El nombre de usuario es requerido')
    .trim()
    .isLength({ min: 1 })
    .withMessage('El nombre de usuario no puede estar vacío'),

  body('password')
    .notEmpty()
    .withMessage('La contraseña es requerida')
    .isLength({ min: 1 })
    .withMessage('La contraseña no puede estar vacía'),

  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Datos de entrada inválidos',
        errors: errors.array()
      });
    }
    next();
  }
]; 